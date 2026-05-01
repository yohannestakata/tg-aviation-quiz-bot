import telebot
from telebot import types
import json
import random
import time
import threading
import os
import sqlite3
from collections import defaultdict
from dotenv import load_dotenv

# ====================== CONFIG ======================
load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
if not TOKEN:
    raise ValueError("BOT_TOKEN is not set! Check your .env file or environment variables.")

bot = telebot.TeleBot(TOKEN, threaded=True)


def get_message_thread_id(message):
    return getattr(message, 'message_thread_id', None)


def make_chat_key(chat_id: int, thread_id=None):
    return (chat_id, thread_id)


def get_message_key(message):
    return make_chat_key(message.chat.id, get_message_thread_id(message))


def get_callback_key(call):
    return make_chat_key(call.message.chat.id, get_message_thread_id(call.message))


def send_chat_message(chat_id: int, text: str, thread_id=None, **kwargs):
    if thread_id is not None:
        kwargs['message_thread_id'] = thread_id
    return bot.send_message(chat_id, text, **kwargs)

# ====================== DATABASE ======================
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_PATH, 'scores.db')


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS user_scores (
            user_id INTEGER PRIMARY KEY,
            first_name TEXT,
            total_score INTEGER DEFAULT 0
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS question_history (
            chat_id INTEGER PRIMARY KEY,
            history_json TEXT DEFAULT '[]'
        )
    ''')
    conn.commit()
    conn.close()


init_db()


def update_user_score(user_id: int, first_name: str, points: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        INSERT INTO user_scores (user_id, first_name, total_score)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            first_name = excluded.first_name,
            total_score = total_score + ?
    ''', (user_id, first_name, points, points))
    conn.commit()
    conn.close()


def get_all_time_leaderboard(limit: int = 10):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        'SELECT first_name, total_score FROM user_scores ORDER BY total_score DESC LIMIT ?',
        (limit,)
    )
    data = cur.fetchall()
    conn.close()
    return data


def get_user_score(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute('SELECT total_score, first_name FROM user_scores WHERE user_id = ?', (user_id,))
    result = cur.fetchone()
    conn.close()
    return result if result else (0, None)


def load_question_history(chat_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute('SELECT history_json FROM question_history WHERE chat_id = ?', (chat_id,))
    row = cur.fetchone()
    conn.close()
    return json.loads(row[0]) if row else []


def save_question_history(chat_id: int, history: list):
    history = history[-10:]  # Keep only last 10 sessions
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        INSERT INTO question_history (chat_id, history_json) VALUES (?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET history_json = excluded.history_json
    ''', (chat_id, json.dumps(history)))
    conn.commit()
    conn.close()


# ====================== QUESTIONS ======================
QUESTIONS_PATH = os.path.join(BASE_PATH, 'questions.json')
with open(QUESTIONS_PATH, 'r', encoding='utf-8') as f:
    ALL_QUESTIONS = json.load(f)

# Category definitions
CATEGORY_KEYS = {
    'all':          '✈️ All Categories',
    'ethiopian':    '🇪🇹 Ethiopian Airlines',
    'aerodynamics': '🌬️ Aerodynamics',
    'systems':      '🔧 Aircraft Systems',
    'meteorology':  '🌦️ Meteorology',
    'airlaw':       '📋 Air Law & Regs',
    'navigation':   '🧭 Navigation',
    'general':      '🌍 General Aviation',
}

DIFFICULTY_KEYS = {
    'all':    '🎯 All Levels',
    'easy':   '🟢 Easy',
    'medium': '🟡 Medium',
    'hard':   '🔴 Hard',
}

CATEGORY_MAP = {
    'ethiopian':    'Ethiopian Airlines & Bole Airport',
    'aerodynamics': 'Aerodynamics & Principles of Flight',
    'systems':      'Aircraft Systems & Instruments',
    'meteorology':  'Meteorology',
    'airlaw':       'Air Law & Regulations',
    'navigation':   'Navigation & Radio Aids',
    'general':      'General Aviation',
}

CAT_EMOJI = {v: CATEGORY_KEYS[k].split()[0] for k, v in CATEGORY_MAP.items()}


def get_category_emoji(category: str) -> str:
    return CAT_EMOJI.get(category, '✈️')


def get_difficulty_label(difficulty: str) -> str:
    return DIFFICULTY_KEYS.get(difficulty, DIFFICULTY_KEYS['medium'])


def select_questions(chat_id: int, cat_key: str, difficulty_key: str, num: int):
    """Pick questions randomly, avoiding the last 10 sessions' used questions."""
    if cat_key == 'all':
        pool = list(range(len(ALL_QUESTIONS)))
    else:
        cat_name = CATEGORY_MAP[cat_key]
        pool = [i for i, q in enumerate(ALL_QUESTIONS) if q.get('category') == cat_name]

    if difficulty_key != 'all':
        pool = [i for i in pool if ALL_QUESTIONS[i].get('difficulty', 'medium') == difficulty_key]

    history = load_question_history(chat_id)
    used = {idx for session in history for idx in session}
    available = [i for i in pool if i not in used]

    # If not enough fresh questions, reset and use full pool
    if len(available) < num:
        available = pool

    num = min(num, len(available))
    selected_indices = random.sample(available, num)
    selected_questions = [ALL_QUESTIONS[i] for i in selected_indices]
    return selected_questions, selected_indices


def is_correct_answer(user_text: str, question: dict) -> bool:
    """Case-insensitive, space-normalised match against answer and acceptable_answers."""
    def norm(s): return s.strip().lower().replace(" ", "")
    given = norm(user_text)
    if given == norm(question['answer']):
        return True
    for alt in question.get('acceptable_answers', []):
        if given == norm(alt):
            return True
    return False


# ====================== STATE ======================
active_games   = {}   # chat_id -> Game
pending_setups = {}   # chat_id -> SetupState
user_names     = {}   # user_id -> first_name


class SetupState:
    def __init__(self, chat_id: int, leader_id: int, thread_id=None):
        self.chat_id = chat_id
        self.thread_id = thread_id
        self.key = make_chat_key(chat_id, thread_id)
        self.leader_id = leader_id
        self.mode = None          # 'individual' | 'group'
        self.cat_key = 'all'
        self.difficulty_key = 'all'
        self.num_questions = 10
        self.state = 'choosing_mode'
        # Group-only fields
        self.num_groups = 0
        self.group_names = []
        self.naming_index = 0
        self.groups = {}          # group_name -> set of user_ids
        self.user_groups = {}     # user_id -> group_name
        self.join_msg_id = None


class Game:
    def __init__(self, chat_id: int, questions: list, indices: list,
                 mode: str, setup: SetupState):
        self.chat_id = chat_id
        self.thread_id = setup.thread_id
        self.key = setup.key
        self.questions = questions
        self.indices = indices
        self.num_questions = len(questions)
        self.mode = mode
        self.leader_id = setup.leader_id
        self.current_index = 0
        self.current_question = None
        self.correct_answer = None
        self.current_explanation = ''
        self.current_category = ''
        self.current_difficulty = 'medium'
        self.hint_level = 0
        self.timer = None
        self.answered = False
        self.waiting_for_continue = False
        self._lock = threading.Lock()
        # Individual scores
        self.scores = defaultdict(int)            # user_id -> pts
        # Group scores
        self.groups = {g: set(members) for g, members in setup.groups.items()}
        self.user_groups = dict(setup.user_groups)
        self.group_scores = defaultdict(int)      # group_name -> pts
        self.group_contributors = defaultdict(int) # user_id -> pts contributed

    def get_hint(self) -> str:
        answer = self.correct_answer.lower().replace(" ", "")
        length = len(answer)
        if self.hint_level == 0:
            return " ".join(["_"] * length)
        elif self.hint_level == 1:
            revealed = list("_" * length)
            picks = random.sample(range(length), min(2, max(1, length // 3)))
            for i in picks:
                revealed[i] = answer[i]
            return " ".join(revealed)
        elif self.hint_level == 2:
            revealed = list("_" * length)
            picks = random.sample(range(length), min(max(3, length // 2), length))
            for i in picks:
                revealed[i] = answer[i]
            return " ".join(revealed)
        else:
            return self.correct_answer


# ====================== GAME FLOW ======================

def _progress_bar(current: int, total: int, width: int = 20) -> str:
    filled = int(current / total * width) if total else 0
    return "▓" * filled + "░" * (width - filled)


def start_new_question(game: Game):
    if game.key not in active_games:
        return
    if game.current_index >= game.num_questions:
        # Save history then show results
        history = load_question_history(game.chat_id)
        save_question_history(game.chat_id, history + [game.indices])
        show_final_leaderboard(game)
        active_games.pop(game.key, None)
        return

    q = game.questions[game.current_index]
    game.current_question = q['question']
    game.correct_answer = q['answer']
    game.current_explanation = q.get('explanation', '')
    game.current_category = q.get('category', '')
    game.current_difficulty = q.get('difficulty', 'medium')
    game.hint_level = 0
    game.answered = False
    game.waiting_for_continue = False

    bar = _progress_bar(game.current_index, game.num_questions)
    cat_emoji = get_category_emoji(game.current_category)
    difficulty_label = get_difficulty_label(game.current_difficulty)
    hint = game.get_hint()

    text = (
        f"✈️ *Question {game.current_index + 1} / {game.num_questions}*\n"
        f"`{bar}`\n"
        f"{cat_emoji} _{game.current_category}_\n\n"
        f"{difficulty_label}\n\n"
        f"❓ *{game.current_question}*\n\n"
        f"💡 `{hint}`\n\n"
        f"✍️ Type your answer! _(Hint in 12s)_"
    )
    send_chat_message(game.chat_id, text, thread_id=game.thread_id, parse_mode='Markdown')
    game.timer = threading.Timer(12.0, give_hint, [game])
    game.timer.start()


def send_continue_prompt(game: Game):
    game.waiting_for_continue = True
    markup = types.InlineKeyboardMarkup()
    label = "➡️ Continue" if game.current_index < game.num_questions else "🏁 Show Results"
    markup.add(types.InlineKeyboardButton(label, callback_data="continue"))
    send_chat_message(
        game.chat_id,
        "Leader, press Continue when ready. Auto-continues in 5 seconds. ✈️",
        thread_id=game.thread_id,
        reply_markup=markup,
    )
    game.timer = threading.Timer(5.0, auto_continue, [game])
    game.timer.start()


def continue_game(game: Game):
    with game._lock:
        if not game.waiting_for_continue or game.key not in active_games:
            return False
        game.waiting_for_continue = False
        if game.timer:
            game.timer.cancel()
            game.timer = None
    start_new_question(game)
    return True


def auto_continue(game: Game):
    continue_game(game)


def give_hint(game: Game):
    with game._lock:
        if game.answered or game.key not in active_games:
            return
        game.hint_level += 1
        hint = game.get_hint()
        level = game.hint_level

    if level == 1:
        send_chat_message(game.chat_id,
            f"🔍 *Hint 1:* `{hint}`\n_(Next hint in 20s)_",
            thread_id=game.thread_id, parse_mode='Markdown')
        game.timer = threading.Timer(20.0, give_hint, [game])
        game.timer.start()
    elif level == 2:
        send_chat_message(game.chat_id,
            f"🔎 *Hint 2:* `{hint}`\n_(Answer reveal in 20s)_",
            thread_id=game.thread_id, parse_mode='Markdown')
        game.timer = threading.Timer(20.0, give_hint, [game])
        game.timer.start()
    else:
        # Time's up — claim answered so message handler can't also fire
        with game._lock:
            if game.answered:
                return
            game.answered = True
            game.current_index += 1

        send_chat_message(game.chat_id,
            f"⏰ *Time's up!*\n\n"
            f"The answer was: *{game.correct_answer}* ✈️\n\n"
            f"📖 _{game.current_explanation}_",
            thread_id=game.thread_id, parse_mode='Markdown')
        send_continue_prompt(game)


def show_live_leaderboard(game: Game):
    if game.mode == 'individual':
        if not game.scores:
            return
        sorted_scores = sorted(game.scores.items(), key=lambda x: x[1], reverse=True)
        text = "🏆 *Current Standings*\n\n"
        for rank, (uid, score) in enumerate(sorted_scores[:10], 1):
            name = user_names.get(uid, f"Pilot {uid}")
            medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else f"{rank}."
            text += f"{medal} {name} — *{score}* pts\n"
    else:
        sorted_groups = sorted(game.group_scores.items(), key=lambda x: x[1], reverse=True)
        text = "🏆 *Group Standings*\n\n"
        if not sorted_groups:
            text += "_No scores yet_\n"
        for rank, (gname, score) in enumerate(sorted_groups, 1):
            medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else f"{rank}."
            text += f"{medal} *{gname}* — {score} pts\n"
        top_contrib = sorted(game.group_contributors.items(), key=lambda x: x[1], reverse=True)[:5]
        if top_contrib:
            text += "\n👤 *Top Contributors*\n"
            for uid, pts in top_contrib:
                name = user_names.get(uid, f"Pilot {uid}")
                grp = game.user_groups.get(uid, "?")
                text += f"  • {name} _({grp})_ — {pts} pts\n"

    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("📊 Refresh Standings", callback_data="standings"))
    send_chat_message(game.chat_id, text, thread_id=game.thread_id,
                      parse_mode='Markdown', reply_markup=markup)


def show_final_leaderboard(game: Game):
    if game.mode == 'individual':
        if game.scores:
            sorted_scores = sorted(game.scores.items(), key=lambda x: x[1], reverse=True)
            text = "🎖️ *Final Quiz Results* 🏆\n\n"
            for rank, (uid, score) in enumerate(sorted_scores, 1):
                name = user_names.get(uid, f"Pilot {uid}")
                medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else "👏"
                text += f"{medal} {rank}. {name} — *{score}* pts\n"
                update_user_score(uid, user_names.get(uid, "Unknown"), score)
            send_chat_message(game.chat_id, text, thread_id=game.thread_id, parse_mode='Markdown')
    else:
        # Group results
        sorted_groups = sorted(game.group_scores.items(), key=lambda x: x[1], reverse=True)
        text = "🎖️ *Group Competition Results* 🏆\n\n"
        if sorted_groups:
            for rank, (gname, score) in enumerate(sorted_groups, 1):
                medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else "👏"
                text += f"{medal} *{gname}* — {score} pts\n"
        else:
            text += "_No group scored any points._\n"
        text += "\n\n👤 *Individual Contributions*\n"
        for gname, members in game.groups.items():
            text += f"\n__{gname}__:\n"
            for uid in members:
                name = user_names.get(uid, f"Pilot {uid}")
                pts = game.group_contributors.get(uid, 0)
                text += f"  • {name} — {pts} pts\n"
                update_user_score(uid, user_names.get(uid, "Unknown"), pts)
        send_chat_message(game.chat_id, text, thread_id=game.thread_id, parse_mode='Markdown')

    # All-time leaderboard
    all_time = get_all_time_leaderboard(10)
    if all_time:
        lb_text = "🏅 *All-Time Top Pilots* ✈️\n\n"
        for rank, (name, score) in enumerate(all_time, 1):
            medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else f"{rank}."
            lb_text += f"{medal} {name} — *{score}* pts\n"
        send_chat_message(game.chat_id, lb_text, thread_id=game.thread_id, parse_mode='Markdown')

    send_chat_message(game.chat_id,
        "✈️ Quiz complete! Fly again with /quiz 🛫",
        thread_id=game.thread_id, parse_mode='Markdown')


# ====================== SETUP UI ======================

def send_mode_keyboard(chat_id: int, thread_id=None):
    markup = types.InlineKeyboardMarkup(row_width=2)
    markup.add(
        types.InlineKeyboardButton("👤 Individual", callback_data="mode:individual"),
        types.InlineKeyboardButton("👥 Group vs Group", callback_data="mode:group"),
    )
    send_chat_message(chat_id,
        "✈️ *Aviation Quiz* — Choose your mode:\n\n"
        "👤 *Individual* — Solo or open competition\n"
        "👥 *Group vs Group* — Team battle!\n\n"
        "_(Only the quiz leader can make this choice)_",
        thread_id=thread_id, parse_mode='Markdown', reply_markup=markup)


def send_category_keyboard(chat_id: int, thread_id=None):
    markup = types.InlineKeyboardMarkup(row_width=2)
    buttons = [
        types.InlineKeyboardButton(label, callback_data=f"cat:{key}")
        for key, label in CATEGORY_KEYS.items()
    ]
    markup.add(*buttons)
    send_chat_message(chat_id, "📚 *Choose a question category:*",
                      thread_id=thread_id, parse_mode='Markdown', reply_markup=markup)


def send_difficulty_keyboard(chat_id: int, thread_id=None):
    markup = types.InlineKeyboardMarkup(row_width=2)
    buttons = [
        types.InlineKeyboardButton(label, callback_data=f"diff:{key}")
        for key, label in DIFFICULTY_KEYS.items()
    ]
    markup.add(*buttons)
    send_chat_message(chat_id, "🎯 *Choose a difficulty level:*",
                      thread_id=thread_id, parse_mode='Markdown', reply_markup=markup)


def send_num_groups_keyboard(chat_id: int, thread_id=None):
    markup = types.InlineKeyboardMarkup(row_width=3)
    markup.add(
        types.InlineKeyboardButton("2 Groups", callback_data="ngroups:2"),
        types.InlineKeyboardButton("3 Groups", callback_data="ngroups:3"),
        types.InlineKeyboardButton("4 Groups", callback_data="ngroups:4"),
    )
    send_chat_message(chat_id, "👥 *How many groups will compete?*",
                      thread_id=thread_id, parse_mode='Markdown', reply_markup=markup)


def build_join_text(setup: SetupState) -> str:
    text = "👥 *Groups are ready! Click your group to join:*\n\n"
    for gname in setup.group_names:
        members = setup.groups.get(gname, set())
        names = [user_names.get(uid, f"Pilot {uid}") for uid in members]
        text += f"*{gname}*: {', '.join(names) if names else '_empty_'}\n"
    text += "\n_(Leader: press 🚀 Start Quiz when all members have joined)_"
    return text


def build_join_markup(setup: SetupState) -> types.InlineKeyboardMarkup:
    markup = types.InlineKeyboardMarkup(row_width=2)
    for gname in setup.group_names:
        markup.add(types.InlineKeyboardButton(f"➕ Join {gname}", callback_data=f"join:{gname}"))
    markup.add(types.InlineKeyboardButton("🚀 Start Quiz!", callback_data="start_quiz"))
    return markup


def send_join_message(chat_id: int, setup: SetupState):
    msg = send_chat_message(chat_id,
        build_join_text(setup),
        thread_id=setup.thread_id,
        parse_mode='Markdown',
        reply_markup=build_join_markup(setup))
    setup.join_msg_id = msg.message_id


def update_join_message(chat_id: int, setup: SetupState):
    if not setup.join_msg_id:
        return
    try:
        bot.edit_message_text(
            build_join_text(setup),
            chat_id, setup.join_msg_id,
            parse_mode='Markdown',
            reply_markup=build_join_markup(setup))
    except Exception:
        pass


# ====================== LAUNCH GAME ======================

def launch_game(chat_id: int, setup: SetupState):
    questions, indices = select_questions(
        chat_id,
        setup.cat_key,
        setup.difficulty_key,
        setup.num_questions,
    )
    if not questions:
        send_chat_message(chat_id,
            "❌ No questions available for that category and difficulty. Try another setup.",
            thread_id=setup.thread_id)
        pending_setups.pop(setup.key, None)
        return

    game = Game(chat_id, questions, indices, setup.mode, setup)
    active_games[setup.key] = game
    pending_setups.pop(setup.key, None)

    cat_label = CATEGORY_KEYS.get(setup.cat_key, 'All Categories')
    difficulty_label = DIFFICULTY_KEYS.get(setup.difficulty_key, 'All Levels')
    mode_label = "Individual Competition" if setup.mode == 'individual' else "Group vs Group"

    send_chat_message(chat_id,
        f"🔥 *Aviation Quiz Starting!* 🛫\n\n"
        f"📚 Category: *{cat_label}*\n"
        f"🎯 Difficulty: *{difficulty_label}*\n"
        f"🏁 Mode: *{mode_label}*\n"
        f"❓ Questions: *{len(questions)}*\n\n"
        f"First correct answer wins the point!\n"
        f"Hints appear automatically after 12s and 20s.\n\n"
        f"After each question, the leader gets 5 seconds to press Continue.\n\n"
        f"Get ready... ✈️",
        thread_id=setup.thread_id, parse_mode='Markdown')
    time.sleep(2)
    start_new_question(game)


# ====================== CALLBACK HANDLER ======================

@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    chat_id = call.message.chat.id
    key = get_callback_key(call)
    user_id = call.from_user.id
    user_names[user_id] = call.from_user.first_name
    data = call.data

    # Refresh standings during an active game
    if data == "standings":
        if key in active_games:
            show_live_leaderboard(active_games[key])
        else:
            bot.answer_callback_query(call.id, "No active quiz.")
        bot.answer_callback_query(call.id)
        return

    if data == "continue":
        game = active_games.get(key)
        if not game:
            bot.answer_callback_query(call.id, "No active quiz.")
            return
        if user_id != game.leader_id:
            bot.answer_callback_query(call.id, "Only the quiz leader can continue.")
            return
        if not continue_game(game):
            bot.answer_callback_query(call.id, "The quiz is already moving.")
            return
        bot.answer_callback_query(call.id, "Continuing...")
        _delete_safely(chat_id, call.message.message_id)
        return

    setup = pending_setups.get(key)

    # ---- Mode selection ----
    if data.startswith("mode:"):
        if not setup:
            bot.answer_callback_query(call.id, "No quiz setup in progress. Use /quiz.")
            return
        if user_id != setup.leader_id:
            bot.answer_callback_query(call.id, "Only the quiz leader can choose the mode.")
            return
        mode = data.split(":", 1)[1]
        setup.mode = mode
        bot.answer_callback_query(call.id)
        _delete_safely(chat_id, call.message.message_id)
        if mode == 'individual':
            setup.state = 'choosing_category'
            send_category_keyboard(chat_id, setup.thread_id)
        else:
            setup.state = 'choosing_num_groups'
            send_num_groups_keyboard(chat_id, setup.thread_id)
        return

    # ---- Category selection ----
    if data.startswith("cat:"):
        if not setup:
            bot.answer_callback_query(call.id, "No quiz setup in progress. Use /quiz.")
            return
        if user_id != setup.leader_id:
            bot.answer_callback_query(call.id, "Only the quiz leader can choose the category.")
            return
        setup.cat_key = data.split(":", 1)[1]
        setup.state = 'choosing_difficulty'
        bot.answer_callback_query(call.id)
        _delete_safely(chat_id, call.message.message_id)
        send_difficulty_keyboard(chat_id, setup.thread_id)
        return

    # ---- Difficulty selection ----
    if data.startswith("diff:"):
        if not setup:
            bot.answer_callback_query(call.id, "No quiz setup in progress. Use /quiz.")
            return
        if user_id != setup.leader_id:
            bot.answer_callback_query(call.id, "Only the quiz leader can choose the difficulty.")
            return
        difficulty_key = data.split(":", 1)[1]
        if difficulty_key not in DIFFICULTY_KEYS:
            bot.answer_callback_query(call.id, "Unknown difficulty.")
            return
        setup.difficulty_key = difficulty_key
        setup.state = 'choosing_num_questions'
        bot.answer_callback_query(call.id)
        _delete_safely(chat_id, call.message.message_id)
        send_chat_message(chat_id,
            f"✅ Category: *{CATEGORY_KEYS[setup.cat_key]}*\n\n"
            f"🎯 Difficulty: *{DIFFICULTY_KEYS[setup.difficulty_key]}*\n\n"
            f"📊 How many questions? _(send a number, 1–50)_",
            thread_id=setup.thread_id, parse_mode='Markdown')
        return

    # ---- Number of groups ----
    if data.startswith("ngroups:"):
        if not setup:
            bot.answer_callback_query(call.id, "No quiz setup in progress. Use /quiz.")
            return
        if user_id != setup.leader_id:
            bot.answer_callback_query(call.id, "Only the quiz leader can do this.")
            return
        setup.num_groups = int(data.split(":", 1)[1])
        setup.state = 'naming_groups'
        setup.naming_index = 0
        bot.answer_callback_query(call.id)
        _delete_safely(chat_id, call.message.message_id)
        send_chat_message(chat_id,
            f"✅ *{setup.num_groups} groups selected!*\n\n"
            f"Leader, send the name for *Group 1*:\n"
            f"_(e.g. Sky Hawks, Bole Eagles, Ethiopian Wings)_",
            thread_id=setup.thread_id, parse_mode='Markdown')
        return

    # ---- Join a group ----
    if data.startswith("join:"):
        if not setup or setup.state != 'waiting_for_join':
            bot.answer_callback_query(call.id, "No active group join phase.")
            return
        gname = data[5:]
        if gname not in setup.group_names:
            bot.answer_callback_query(call.id, "Unknown group.")
            return
        # Remove from old group if already in one
        old = setup.user_groups.get(user_id)
        if old and old in setup.groups:
            setup.groups[old].discard(user_id)
        # Add to chosen group
        setup.groups.setdefault(gname, set()).add(user_id)
        setup.user_groups[user_id] = gname
        bot.answer_callback_query(call.id, f"✅ You joined {gname}!")
        update_join_message(chat_id, setup)
        return

    # ---- Start quiz (group mode) ----
    if data == "start_quiz":
        if not setup:
            bot.answer_callback_query(call.id, "No quiz setup in progress. Use /quiz.")
            return
        if user_id != setup.leader_id:
            bot.answer_callback_query(call.id, "Only the quiz leader can start the quiz.")
            return
        empty = [g for g, m in setup.groups.items() if not m]
        if empty:
            bot.answer_callback_query(call.id,
                f"These groups are empty: {', '.join(empty)}. "
                "Have members join first!")
            return
        bot.answer_callback_query(call.id, "🚀 Launching quiz!")
        _delete_safely(chat_id, call.message.message_id)
        launch_game(chat_id, setup)
        return

    bot.answer_callback_query(call.id)


def _delete_safely(chat_id: int, message_id: int):
    try:
        bot.delete_message(chat_id, message_id)
    except Exception:
        pass


# ====================== COMMANDS ======================

@bot.message_handler(commands=['start'])
def cmd_start(message):
    user_names[message.from_user.id] = message.from_user.first_name
    send_chat_message(message.chat.id,
        "🛫 *Welcome to Aviation Quiz Bot!* ✈️\n\n"
        "Test your Ethiopian Airlines & aviation knowledge!\n\n"
        "📋 *Commands:*\n"
        "• /quiz — Start a new quiz\n"
        "• /leaderboard — All-time top pilots\n"
        "• /categories — Browse question categories\n"
        "• /mystats — Your personal score\n"
        "• /groups — Live group standings\n"
        "• /mygroup — Your current group\n"
        "• /stop — Stop current quiz\n"
        "• /help — Help & instructions\n\n"
        "Use /quiz to choose mode, category, difficulty, and question count! 🔥",
        thread_id=get_message_thread_id(message), parse_mode='Markdown')


@bot.message_handler(commands=['quiz'])
def cmd_quiz(message):
    chat_id = message.chat.id
    key = get_message_key(message)
    thread_id = get_message_thread_id(message)
    user_id = message.from_user.id
    user_names[user_id] = message.from_user.first_name

    if key in active_games:
        send_chat_message(chat_id,
            "⚠️ A quiz is already running! Use /stop to end it first.",
            thread_id=thread_id)
        return
    if key in pending_setups:
        send_chat_message(chat_id,
            "⚠️ A quiz setup is already in progress.",
            thread_id=thread_id)
        return

    setup = SetupState(chat_id, user_id, thread_id)
    pending_setups[key] = setup
    send_mode_keyboard(chat_id, thread_id)


@bot.message_handler(commands=['stop'])
def cmd_stop(message):
    chat_id = message.chat.id
    key = get_message_key(message)
    thread_id = get_message_thread_id(message)
    user_id = message.from_user.id

    if key in pending_setups:
        setup = pending_setups[key]
        if user_id == setup.leader_id:
            pending_setups.pop(key, None)
            send_chat_message(chat_id, "🛑 Quiz setup cancelled.", thread_id=thread_id)
        else:
            send_chat_message(chat_id, "⚠️ Only the quiz leader can cancel the setup.",
                              thread_id=thread_id)
        return

    if key in active_games:
        game = active_games[key]
        if user_id == game.leader_id:
            if game.timer:
                game.timer.cancel()
            active_games.pop(key, None)
            send_chat_message(chat_id, "🛑 *Quiz stopped by the leader.*",
                              thread_id=thread_id, parse_mode='Markdown')
        else:
            send_chat_message(chat_id, "⚠️ Only the quiz leader can stop the quiz.",
                              thread_id=thread_id)
        return

    send_chat_message(chat_id, "No active quiz to stop.", thread_id=thread_id)


@bot.message_handler(commands=['mystats'])
def cmd_mystats(message):
    user_id = message.from_user.id
    score, _ = get_user_score(user_id)
    all_time = get_all_time_leaderboard(100)
    rank = "N/A"
    for i, (name, _) in enumerate(all_time):
        if name == user_names.get(user_id):
            rank = i + 1
            break
    send_chat_message(message.chat.id,
        f"✈️ *Your Aviation Stats*\n\n"
        f"👤 *{message.from_user.first_name}*\n"
        f"🏆 All-time score: *{score}* pts\n"
        f"📊 Global rank: *#{rank}*\n\n"
        "Keep flying and climbing the board! 🚀",
        thread_id=get_message_thread_id(message), parse_mode='Markdown')


@bot.message_handler(commands=['leaderboard'])
def cmd_leaderboard(message):
    data = get_all_time_leaderboard(10)
    if not data:
        send_chat_message(message.chat.id,
            "No scores yet — be the first! Use /quiz to start playing.",
            thread_id=get_message_thread_id(message))
        return
    text = "🏅 *All-Time Top Pilots* ✈️\n\n"
    for rank, (name, score) in enumerate(data, 1):
        medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else f"{rank}."
        text += f"{medal} {name} — *{score}* pts\n"
    send_chat_message(message.chat.id, text, thread_id=get_message_thread_id(message),
                      parse_mode='Markdown')


@bot.message_handler(commands=['categories'])
def cmd_categories(message):
    text = "📚 *Question Categories* ✈️\n\n"
    for key, label in CATEGORY_KEYS.items():
        if key == 'all':
            count = len(ALL_QUESTIONS)
        else:
            cat_name = CATEGORY_MAP[key]
            count = sum(1 for q in ALL_QUESTIONS if q.get('category') == cat_name)
        text += f"{label} — *{count}* questions\n"
    text += "\n🎯 *Difficulty Levels*\n"
    for key, label in DIFFICULTY_KEYS.items():
        if key == 'all':
            count = len(ALL_QUESTIONS)
        else:
            count = sum(1 for q in ALL_QUESTIONS if q.get('difficulty', 'medium') == key)
        text += f"{label} — *{count}* questions\n"

    text += "\nUse /quiz and pick a category + difficulty to play! 🎮"
    send_chat_message(message.chat.id, text, thread_id=get_message_thread_id(message),
                      parse_mode='Markdown')


@bot.message_handler(commands=['groups'])
def cmd_groups(message):
    chat_id = message.chat.id
    key = get_message_key(message)
    thread_id = get_message_thread_id(message)
    if key not in active_games:
        send_chat_message(chat_id, "No active quiz. Use /quiz to start one.", thread_id=thread_id)
        return
    game = active_games[key]
    if game.mode != 'group':
        send_chat_message(chat_id, "This is an individual competition — no groups!",
                          thread_id=thread_id)
        return
    show_live_leaderboard(game)


@bot.message_handler(commands=['mygroup'])
def cmd_mygroup(message):
    chat_id = message.chat.id
    key = get_message_key(message)
    thread_id = get_message_thread_id(message)
    user_id = message.from_user.id
    if key not in active_games:
        send_chat_message(chat_id, "No active quiz.", thread_id=thread_id)
        return
    game = active_games[key]
    if game.mode != 'group':
        send_chat_message(chat_id, "This is an individual quiz — no groups here!",
                          thread_id=thread_id)
        return
    gname = game.user_groups.get(user_id)
    if gname:
        gscore = game.group_scores.get(gname, 0)
        my_pts = game.group_contributors.get(user_id, 0)
        send_chat_message(chat_id,
            f"👥 You are in *{gname}*\n"
            f"Group score: *{gscore}* pts\n"
            f"Your contribution: *{my_pts}* pts ✈️",
            thread_id=thread_id, parse_mode='Markdown')
    else:
        send_chat_message(chat_id,
            "You are not assigned to any group for this quiz.\n"
            "Ask the leader to restart and join a group next time.",
            thread_id=thread_id)


@bot.message_handler(commands=['help'])
def cmd_help(message):
    send_chat_message(message.chat.id,
        "🛫 *Aviation Quiz Bot — Help* ✈️\n\n"
        "*Commands:*\n"
        "/quiz — Start a new quiz\n"
        "/stop — Stop current quiz _(leader only)_\n"
        "/leaderboard — All-time top pilots\n"
        "/mystats — Your personal statistics\n"
        "/categories — Browse question categories\n"
        "/groups — Live group standings _(group mode)_\n"
        "/mygroup — Your current group _(group mode)_\n"
        "/help — This help message\n\n"
        "*How to play:*\n"
        "• Type your answer freely — no multiple choice!\n"
        "• First correct answer wins the point\n"
        "• Hints appear at 12s and 32s automatically\n"
        "• Answer + explanation shown after each question\n"
        "• Send answers normally in the quiz topic; no reply needed\n"
        "• The quiz leader gets 5 seconds to press Continue for the next question\n"
        "• Questions don't repeat for 10 rounds!\n"
        "• Quiz leaders choose category and difficulty before launch\n\n"
        "*Modes:*\n"
        "👤 *Individual* — open competition, everyone answers\n"
        "👥 *Group vs Group* — team battle, 2–4 groups\n\n"
        "*Categories:* 7 aviation topics covering ETH, aerodynamics, systems, meteorology, air law, navigation & general aviation! 🌍\n"
        "*Difficulties:* Easy, Medium, Hard, or All Levels.",
        thread_id=get_message_thread_id(message), parse_mode='Markdown')


# ====================== MAIN MESSAGE HANDLER ======================

@bot.message_handler(func=lambda m: True)
def handle_message(message):
    chat_id = message.chat.id
    key = get_message_key(message)
    thread_id = get_message_thread_id(message)
    user = message.from_user
    user_names[user.id] = user.first_name

    setup = pending_setups.get(key)

    # --- Setup: leader naming groups ---
    if setup and setup.state == 'naming_groups' and user.id == setup.leader_id:
        gname = message.text.strip()
        if not gname or gname.startswith('/'):
            return
        setup.group_names.append(gname)
        setup.groups[gname] = set()
        setup.naming_index += 1
        if setup.naming_index < setup.num_groups:
            send_chat_message(chat_id,
                f"✅ *{gname}* created!\n\n"
                f"Now send the name for *Group {setup.naming_index + 1}*:",
                thread_id=thread_id, parse_mode='Markdown')
        else:
            # All groups named → move to category selection
            names_str = ', '.join(f"*{g}*" for g in setup.group_names)
            send_chat_message(chat_id,
                f"✅ Groups ready: {names_str}\n\nNow choose a category:",
                thread_id=thread_id, parse_mode='Markdown')
            setup.state = 'choosing_category'
            send_category_keyboard(chat_id, thread_id)
        return

    # --- Setup: leader entering number of questions ---
    if setup and setup.state == 'choosing_num_questions' and user.id == setup.leader_id:
        if message.text.strip().startswith('/'):
            return
        try:
            num = int(message.text.strip())
            num = max(1, min(50, num))
            setup.num_questions = num
            if setup.mode == 'group':
                setup.state = 'waiting_for_join'
                send_join_message(chat_id, setup)
            else:
                launch_game(chat_id, setup)
        except ValueError:
            send_chat_message(chat_id, "Please send a number between 1 and 50. ✈️",
                              thread_id=thread_id)
        return

    # --- Active quiz: process answer ---
    if key not in active_games:
        return

    game = active_games[key]
    if message.text.strip().startswith('/'):
        return  # Commands handled by their own handlers

    with game._lock:
        if game.answered:
            return
        q = game.questions[game.current_index]
        if not is_correct_answer(message.text, q):
            return
        # Correct answer — claim the point
        game.answered = True
        if game.timer:
            game.timer.cancel()
        explanation = game.current_explanation

        if game.mode == 'individual':
            game.scores[user.id] += 1
            score_line = f"Well done *{user.first_name}* — +1 point! ✈️"
        else:
            gname = game.user_groups.get(user.id, None)
            if gname:
                game.group_scores[gname] += 1
                game.group_contributors[user.id] += 1
                score_line = f"*{user.first_name}* scores for *{gname}*! +1 pt ✈️"
            else:
                score_line = f"*{user.first_name}* answered correctly! ✈️ _(not in a group)_"

        game.current_index += 1

    send_chat_message(chat_id,
        f"✅ *Correct!* 🎉\n"
        f"{score_line}\n\n"
        f"📖 _{explanation}_",
        thread_id=thread_id, parse_mode='Markdown')

    show_live_leaderboard(game)
    send_continue_prompt(game)


# ====================== RUN ======================
print("🛫 Aviation Quiz Bot is running! Ready for takeoff...")
bot.infinity_polling(timeout=60, long_polling_timeout=60)
