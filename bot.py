import telebot
import json
import random
import time
import threading
import os
import sqlite3
from collections import defaultdict
from dotenv import load_dotenv   # ← NEW IMPORT

# ====================== CONFIG ======================
# Load .env file for local development
load_dotenv()

TOKEN = os.getenv("BOT_TOKEN")

if not TOKEN:
    raise ValueError("BOT_TOKEN is not set! Check your .env file or environment variables.")

bot = telebot.TeleBot(TOKEN)

# ====================== DATABASE SETUP ======================
base_path = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(base_path, 'scores.db')

def init_db():
    conn = sqlite3.connect(db_path)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS user_scores (
            user_id INTEGER PRIMARY KEY,
            first_name TEXT,
            total_score INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def update_user_score(user_id: int, first_name: str, points: int):
    """Add points to user's lifetime score"""
    conn = sqlite3.connect(db_path)
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
    """Get top players of all time"""
    conn = sqlite3.connect(db_path)
    cursor = conn.execute('''
        SELECT first_name, total_score 
        FROM user_scores 
        ORDER BY total_score DESC 
        LIMIT ?
    ''', (limit,))
    data = cursor.fetchall()
    conn.close()
    return data

# ====================== LOAD QUESTIONS ======================
json_path = os.path.join(base_path, 'questions.json')
with open(json_path, 'r', encoding='utf-8') as f:
    all_questions = json.load(f)

# ====================== GAME STATE ======================
active_games = {}
user_scores = defaultdict(lambda: defaultdict(int))  # Per quiz scores
user_names = {}

class Game:
    def __init__(self, chat_id, num_questions):
        self.chat_id = chat_id
        self.num_questions = min(num_questions, len(all_questions))
        self.questions = random.sample(all_questions, self.num_questions)
        self.current_index = 0
        self.current_question = None
        self.correct_answer = None
        self.hint_level = 0
        self.timer = None
        self.answered = False

    def get_hint(self):
        answer = self.correct_answer.lower().replace(" ", "")
        length = len(answer)
        
        if self.hint_level == 0:
            return " ".join(["_"] * length)
        elif self.hint_level == 1:
            revealed = ["_"] * length
            indices = random.sample(range(length), min(2, length//2))
            for i in indices:
                revealed[i] = answer[i]
            return " ".join(revealed)
        elif self.hint_level == 2:
            revealed = ["_"] * length
            num = max(3, length // 2)
            indices = random.sample(range(length), num)
            for i in indices:
                revealed[i] = answer[i]
            return " ".join(revealed)
        else:
            return self.correct_answer


def start_new_question(game):
    if game.current_index >= game.num_questions:
        show_final_leaderboard(game.chat_id)
        active_games.pop(game.chat_id, None)
        return

    q = game.questions[game.current_index]
    game.current_question = q["question"]
    game.correct_answer = q["answer"]
    game.hint_level = 0
    game.answered = False

    bot.send_message(game.chat_id,
        f"✈️ **Question {game.current_index + 1} / {game.num_questions}** 🛫\n\n"
        f"**{game.current_question}**\n\n"
        "✍️ Type your answer below!", 
        parse_mode='Markdown')

    game.timer = threading.Timer(12.0, give_hint, [game])
    game.timer.start()


def give_hint(game):
    if game.answered or game.chat_id not in active_games:
        return

    game.hint_level += 1
    hint = game.get_hint()

    if game.hint_level <= 2:
        bot.send_message(game.chat_id, f"💡 **Hint:** `{hint}`", parse_mode='Markdown')
        game.timer = threading.Timer(20.0, give_hint, [game])
        game.timer.start()
    else:
        bot.send_message(game.chat_id, 
            f"⏰ Time's up!\n\n"
            f"The correct answer is:\n**{game.correct_answer}** ✈️", 
            parse_mode='Markdown')
        game.current_index += 1
        time.sleep(2)
        start_new_question(game)


def show_live_leaderboard(chat_id):
    scores = user_scores[chat_id]
    if not scores:
        return

    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)

    text = "🏆 **Current Standings**\n\n"
    for rank, (user_id, score) in enumerate(sorted_scores[:10], 1):
        name = user_names.get(user_id, f"Pilot {user_id}")
        text += f"{rank}. {name} — **{score}** points\n"

    bot.send_message(chat_id, text, parse_mode='Markdown')


def show_final_leaderboard(chat_id):
    scores = user_scores[chat_id]
    
    # Show this quiz leaderboard
    if scores:
        sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        text = "🎖️ **Quiz Leaderboard** 🏆\n\n"
        for rank, (user_id, score) in enumerate(sorted_scores, 1):
            name = user_names.get(user_id, f"Pilot {user_id}")
            medal = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else "👏"
            text += f"{medal} {rank}. {name} — **{score}** points\n"
        bot.send_message(chat_id, text, parse_mode='Markdown')

    # Save scores to database
    for user_id, quiz_score in scores.items():
        name = user_names.get(user_id, "Unknown Pilot")
        update_user_score(user_id, name, quiz_score)

    # Show All-Time Leaderboard
    all_time = get_all_time_leaderboard(10)
    if all_time:
        text = "\n🏅 **All-Time Top Pilots** 🏆\n\n"
        for rank, (name, score) in enumerate(all_time, 1):
            text += f"{rank}. {name} — **{score}** points\n"
        bot.send_message(chat_id, text, parse_mode='Markdown')

    active_games.pop(chat_id, None)


# ====================== COMMANDS ======================
@bot.message_handler(commands=['start'])
def start(message):
    user_names[message.from_user.id] = message.from_user.first_name
    bot.send_message(message.chat.id,
        "🛫 **Welcome to Aviation Quiz Bot!** ✈️\n\n"
        "Test your aviation knowledge with friends!\n\n"
        "Commands:\n"
        "/quiz → Start a new quiz\n"
        "/stop → Stop current quiz\n"
        "/mystats → See your total score\n"
        "/help → Show help",
        parse_mode='Markdown')


@bot.message_handler(commands=['quiz'])
def start_quiz(message):
    user_names[message.from_user.id] = message.from_user.first_name
    bot.send_message(message.chat.id,
        "📊 **How many questions do you want?**\n\n"
        "Send a number (Recommended: 10, 15, 20, 25, 30)",
        parse_mode='Markdown')


@bot.message_handler(commands=['stop'])
def stop_quiz(message):
    chat_id = message.chat.id
    if chat_id in active_games:
        if active_games[chat_id].timer:
            active_games[chat_id].timer.cancel()
        active_games.pop(chat_id, None)
        bot.send_message(chat_id, "🛑 **Quiz has been stopped.**")
    else:
        bot.send_message(chat_id, "No active quiz running.")


@bot.message_handler(commands=['mystats'])
def my_stats(message):
    user_id = message.from_user.id
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("SELECT total_score FROM user_scores WHERE user_id = ?", (user_id,))
    result = cursor.fetchone()
    conn.close()

    score = result[0] if result else 0
    bot.send_message(message.chat.id,
        f"✈️ **Your All-Time Score**\n\n"
        f"**{score}** points\n\n"
        "Keep answering correctly and climb the leaderboard! 🏆",
        parse_mode='Markdown')


@bot.message_handler(commands=['help'])
def help_command(message):
    bot.send_message(message.chat.id,
        "🛫 **Aviation Quiz Bot Help**\n\n"
        "/start - Welcome message\n"
        "/quiz - Start new quiz\n"
        "/stop - Stop current quiz\n"
        "/mystats - Show your total score\n"
        "/help - This help message\n\n"
        "Just type the correct answer when the question appears!\n"
        "First correct answer wins the point.",
        parse_mode='Markdown')


# ====================== MAIN MESSAGE HANDLER ======================
@bot.message_handler(func=lambda m: True)
def handle_message(message):
    chat_id = message.chat.id
    user = message.from_user
    user_names[user.id] = user.first_name

    if chat_id not in active_games:
        # User is choosing number of questions
        try:
            num = int(message.text.strip())
            if num < 1: num = 5
            if num > 50: num = 50

            game = Game(chat_id, num)
            active_games[chat_id] = game
            user_scores[chat_id].clear()

            bot.send_message(chat_id, 
                f"🔥 **Aviation Quiz Starting!** 🛫\n"
                f"**{num} questions** loaded.\n"
                "Get ready... First question coming up!", 
                parse_mode='Markdown')
            
            time.sleep(1.8)
            start_new_question(game)
        except ValueError:
            bot.send_message(chat_id, "Please send a number or use /quiz to start a game.")
        return

    # Handle answer during active quiz
    game = active_games[chat_id]
    if game.answered:
        return

    user_answer = message.text.strip().lower()
    correct = game.correct_answer.lower()

    # Flexible matching
    if (user_answer == correct) or (user_answer.replace(" ", "") == correct.replace(" ", "")):
        game.answered = True
        if game.timer:
            game.timer.cancel()

        user_scores[chat_id][user.id] += 1

        bot.send_message(chat_id,
            f"✅ **Correct!** 🎉\n"
            f"Well done, **{user.first_name}** (+1 point) ✈️",
            parse_mode='Markdown')

        show_live_leaderboard(chat_id)

        game.current_index += 1
        time.sleep(2)
        start_new_question(game)


print("🛫 Aviation Quiz Bot with Persistent Scores is running...")
bot.infinity_polling()