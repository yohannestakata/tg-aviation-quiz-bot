# Aviation Quiz Telegram Bot — Product & Technical Documentation

## 1. Overview

This project is a Telegram bot for aviation-related quizzes. The bot can be used in private chats for individual practice and inside Telegram groups for group quizzes, competitions, and leaderboards.

Users can select aviation categories, choose the number of questions, select the question type, answer questions, receive scores, and compare performance through leaderboards.

The system also includes an admin dashboard where authorized admins can manage categories, create questions, upload question images through Cloudinary, configure answer options, choose question types, and monitor quiz activity.

## 2. Goals

The main goal is to create a learning and practice platform for aviation topics inside Telegram.

The bot should support:

- Individual quiz practice
- Group-based quiz sessions
- Category-based question selection
- Multiple question types
- Scoring and answer feedback
- Group and global leaderboards
- Admin-managed question bank
- Image-supported aviation questions
- A backend API that can grow into a full web platform later

## 3. Non-Goals for Version 1

The first version should not try to become a complete LMS or aviation training platform.

The following can be postponed:

- Paid subscriptions
- Certificates
- AI-generated explanations
- Voice-based answers
- Full mobile app
- Complex adaptive learning
- Real-time web sockets for dashboard monitoring
- Multi-language support

These can be added later once the core quiz experience is stable.

## 4. Recommended Tech Stack

### 4.1 Telegram Bot

Use the official Telegram Bot API through a Node.js bot framework.

Recommended libraries:

- `grammY` — clean, modern, good TypeScript support
- `Telegraf` — popular and mature

Recommended choice: **grammY** if starting fresh.

Reason: it has a clean middleware model, good session handling, and works well with Express webhooks.

### 4.2 Backend

Use **Express.js** with Node.js.

Responsibilities:

- Receive Telegram webhook updates
- Run quiz logic
- Store quiz sessions and answers
- Expose REST APIs for the admin dashboard
- Handle authentication for admins
- Connect to PostgreSQL
- Handle Cloudinary image uploads

### 4.3 Database

Use **PostgreSQL**.

Postgres is a good fit because the app has relational data:

- Users
- Groups
- Categories
- Questions
- Options
- Quiz sessions
- Answers
- Scores
- Leaderboards
- Admins

Recommended ORM/query layer:

- Prisma — easiest for schema management and migrations
- Drizzle — lightweight and SQL-like
- Knex — flexible query builder

Recommended choice: **Prisma** for faster development and easier admin dashboard integration.

### 4.4 Frontend/Admin Dashboard

Yes, you can use JavaScript for the frontend.

Recommended options:

#### Option A: React + Vite

Good if you want a simple admin dashboard separated from the backend.

#### Option B: Next.js

Good if you may later expand into a public web platform, landing page, analytics, SEO pages, or docs.

#### Option C: Plain HTML/JS

Possible, but not recommended for this project because the dashboard has forms, tables, auth, image uploads, filters, and editing workflows.

Recommended choice: **React + Vite** or **Next.js**.

If this is mainly an internal admin dashboard, use **React + Vite**.
If you may later create a public aviation quiz website, use **Next.js**.

### 4.5 Image Hosting

Use **Cloudinary** for question images.

Admin dashboard uploads images to Cloudinary. The returned Cloudinary URL is stored in Postgres and attached to the question.

### 4.6 Deployment

Recommended deployment:

- Backend: VPS, Render, Railway, Fly.io, or Coolify
- Database: Supabase Postgres, Neon, Railway Postgres, or self-hosted Postgres
- Admin dashboard: Netlify, Vercel, or served from Express
- Images: Cloudinary
- Telegram: Webhook pointing to backend HTTPS endpoint

For your current stack, **Coolify + PostgreSQL + Express + React/Next dashboard** is a good fit.

## 5. System Architecture

```txt
Telegram Users / Groups
        ↓
Telegram Bot API
        ↓ webhook
Express Backend
        ↓
Quiz Engine / Bot Handlers
        ↓
PostgreSQL Database
        ↓
Admin Dashboard API
        ↑
React / Next.js Admin Dashboard
        ↓
Cloudinary Image Uploads
```

## 6. Main User Types

### 6.1 Telegram User

A normal user who interacts with the bot in a private chat or group.

They can:

- Start a quiz
- Choose category
- Choose number of questions
- Choose question type
- Answer questions
- View score
- View personal stats
- View leaderboard

### 6.2 Group Participant

A Telegram user participating in a group quiz.

They can:

- Join group quizzes
- Answer questions during group sessions
- Compete with others
- Appear on group leaderboard

### 6.3 Telegram Group Admin

A group admin who controls bot behavior in a Telegram group.

They can:

- Start group quiz sessions
- Configure quiz options
- End quiz sessions
- View group leaderboard

### 6.4 System Admin

A platform admin using the web dashboard.

They can:

- Create categories
- Add/edit/delete questions
- Add options for multiple choice questions
- Add correct answers
- Upload question images
- Manage difficulty levels
- View usage analytics
- Manage other admins

## 7. Core Features

## 7.1 Private Quiz Mode

Private quiz mode happens in a direct chat between the user and the bot.

Flow:

1. User sends `/start`
2. Bot welcomes the user
3. User selects `Start Quiz`
4. Bot asks for category
5. User selects category
6. Bot asks for number of questions
7. User selects number
8. Bot asks for question type
9. User selects short answer, multiple choice, or mixed
10. Bot starts quiz
11. User answers each question
12. Bot gives feedback depending on quiz settings
13. Bot calculates final score
14. Bot shows result summary
15. Score is saved to leaderboard/statistics

## 7.2 Group Quiz Mode

Group quiz mode happens inside a Telegram group where the bot has been added.

Flow:

1. Group admin sends `/quiz`
2. Bot shows quiz setup options
3. Admin chooses category, number of questions, and question type
4. Bot announces quiz start
5. Users join or answer directly depending on mode
6. Bot posts questions to the group
7. Participants answer
8. Bot records answers
9. Bot moves to the next question after timeout or after all active users answer
10. Bot calculates scores
11. Bot posts final group results
12. Leaderboard is updated

## 7.3 Quiz Categories

Categories represent aviation topics.

Example categories:

- Aerodynamics
- Aircraft Systems
- Meteorology
- Navigation
- Air Law
- Human Performance
- Flight Instruments
- Radio Telephony
- Aircraft Performance
- Principles of Flight
- Operational Procedures
- General Aviation Knowledge

Each question belongs to one main category.

Optional future feature: allow one question to belong to multiple categories.

## 7.4 Question Types

### Multiple Choice

The user receives a question and several answer options.

Example:

Question: What does angle of attack refer to?

A. The angle between the wing chord line and relative airflow  
B. The angle between the runway and aircraft nose  
C. The angle between true north and magnetic north  
D. The angle between the elevator and stabilizer

Correct answer: A

### Short Answer

The user types the answer manually.

Example:

Question: What are the four forces of flight?

Expected answer keywords:

- lift
- weight
- thrust
- drag

Short answer scoring can be exact match in Version 1 and keyword/fuzzy matching later.

### Image-Based Question

A question may include an image.

Example:

- Instrument reading
- Weather chart
- Aircraft component diagram
- Runway sign
- Navigation symbol

The image is uploaded from the admin dashboard to Cloudinary.

The Cloudinary URL is stored on the question record.

## 7.5 Scoring

Recommended Version 1 scoring:

- Correct answer: +1 point
- Wrong answer: 0 points
- Skipped answer: 0 points

Optional scoring improvements:

- Faster answers get bonus points
- Hard questions give more points
- Streak bonus
- Negative marking
- Partial scoring for short answers

Recommended default:

Do not use negative marking in Version 1. It can make casual group quizzes less fun.

## 7.6 Leaderboards

Leaderboards can be shown in different scopes.

### Personal Stats

Shows the user's own performance.

Metrics:

- Total quizzes completed
- Total questions answered
- Correct answers
- Accuracy percentage
- Best category
- Weakest category

### Group Leaderboard

Shows top users in a specific Telegram group.

Metrics:

- Rank
- User display name
- Points
- Accuracy
- Quizzes completed

### Global Leaderboard

Shows top users across all users of the bot.

This can be added after group and personal stats are stable.

## 8. Telegram Commands

Recommended bot commands:

```txt
/start - Start using the bot
/help - Show help
/quiz - Start a quiz
/categories - Show categories
/leaderboard - Show leaderboard
/mystats - Show personal stats
/settings - Configure personal quiz settings
/cancel - Cancel current quiz
```

Group-specific commands:

```txt
/groupquiz - Start a group quiz
/groupleaderboard - Show group leaderboard
/endquiz - End active group quiz
```

Admin-only Telegram commands can exist, but the main admin work should happen in the web dashboard.

## 9. Bot Interaction Design

Use Telegram inline keyboards as much as possible.

Example category selection:

```txt
Choose a category:
[ Aerodynamics ] [ Meteorology ]
[ Navigation ]   [ Air Law ]
[ Mixed ]
```

Example question type selection:

```txt
Choose question type:
[ Multiple Choice ]
[ Short Answer ]
[ Mixed ]
```

Example number of questions:

```txt
How many questions?
[ 5 ] [ 10 ] [ 20 ]
```

## 10. Admin Dashboard Features

## 10.1 Authentication

Admins must log in before accessing the dashboard.

Recommended Version 1 auth:

- Email and password login
- JWT access token
- Passwords hashed using bcrypt
- Admin role stored in database

Optional later:

- Google login
- Two-factor authentication
- Audit logs

## 10.2 Dashboard Home

Shows overview metrics:

- Total questions
- Total categories
- Total users
- Total quizzes completed
- Most active groups
- Most attempted categories
- Questions with low success rate

## 10.3 Category Management

Admins can:

- Create category
- Edit category
- Delete category
- Enable/disable category
- Add description
- Set display order

Category fields:

- Name
- Slug
- Description
- Is active
- Display order

## 10.4 Question Management

Admins can:

- Create question
- Edit question
- Delete/archive question
- Choose category
- Choose question type
- Add image
- Set difficulty
- Add explanation
- Mark active/inactive

Question fields:

- Category
- Question text
- Question type
- Image URL
- Difficulty
- Correct answer
- Explanation
- Active status

## 10.5 Multiple Choice Option Management

For multiple choice questions, admins can add options.

Each option has:

- Option text
- Is correct
- Display order

Rules:

- Multiple choice questions must have at least 2 options
- Usually 4 options are preferred
- One option should be marked correct for single-answer MCQs

## 10.6 Short Answer Management

Short answer questions need acceptable answers.

Example:

Question: What are the four forces of flight?

Acceptable answer keywords:

- lift
- weight
- thrust
- drag

Version 1 can use exact answer or keyword matching.

Better structure:

- `correct_answer_text`
- `accepted_keywords`
- `case_sensitive: false`

## 10.7 Image Uploads

Admin uploads image from dashboard.

Flow:

1. Admin selects image
2. Frontend sends image to backend
3. Backend uploads image to Cloudinary
4. Cloudinary returns URL and public ID
5. Backend stores URL/public ID in database
6. Question displays image when asked in Telegram

Store both:

- `image_url`
- `cloudinary_public_id`

This allows deleting/replacing images later.

## 11. Database Design

## 11.1 Main Tables

Recommended tables:

- `users`
- `telegram_groups`
- `categories`
- `questions`
- `question_options`
- `quiz_sessions`
- `quiz_session_questions`
- `quiz_answers`
- `leaderboard_entries`
- `admins`
- `admin_audit_logs`

## 11.2 Users Table

Stores Telegram users.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.3 Telegram Groups Table

Stores Telegram group information.

```sql
CREATE TABLE telegram_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id BIGINT UNIQUE NOT NULL,
  title TEXT,
  type TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.4 Categories Table

```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.5 Questions Table

```sql
CREATE TYPE question_type AS ENUM ('multiple_choice', 'short_answer');
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id),
  question_text TEXT NOT NULL,
  question_type question_type NOT NULL,
  difficulty difficulty_level DEFAULT 'medium',
  image_url TEXT,
  cloudinary_public_id TEXT,
  correct_answer_text TEXT,
  accepted_keywords TEXT[],
  explanation TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.6 Question Options Table

```sql
CREATE TABLE question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.7 Quiz Sessions Table

```sql
CREATE TYPE quiz_mode AS ENUM ('private', 'group');
CREATE TYPE quiz_status AS ENUM ('active', 'completed', 'cancelled');

CREATE TABLE quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode quiz_mode NOT NULL,
  status quiz_status DEFAULT 'active',
  user_id UUID REFERENCES users(id),
  group_id UUID REFERENCES telegram_groups(id),
  category_id UUID REFERENCES categories(id),
  question_type question_type,
  total_questions INTEGER NOT NULL,
  current_question_index INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

For mixed question type, `question_type` can be nullable or expanded later into an enum value called `mixed`.

## 11.8 Quiz Session Questions Table

Stores the exact questions used in a quiz session.

```sql
CREATE TABLE quiz_session_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id),
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

This is important because it preserves the quiz history even if the question bank changes later.

## 11.9 Quiz Answers Table

```sql
CREATE TABLE quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  selected_option_id UUID REFERENCES question_options(id),
  answer_text TEXT,
  is_correct BOOLEAN NOT NULL,
  points_awarded INTEGER DEFAULT 0,
  answered_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.10 Admins Table

```sql
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 11.11 Admin Audit Logs Table

```sql
CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admins(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## 12. Backend API Design

## 12.1 Public Bot Webhook

```txt
POST /telegram/webhook
```

Receives Telegram updates.

This endpoint should not be used by normal frontend users.

Security recommendation:

- Use a secret webhook path or Telegram webhook secret token
- Validate incoming Telegram requests

Example:

```txt
POST /telegram/webhook/:secret
```

## 12.2 Admin Auth APIs

```txt
POST /api/admin/auth/login
POST /api/admin/auth/logout
GET  /api/admin/auth/me
```

## 12.3 Category APIs

```txt
GET    /api/admin/categories
POST   /api/admin/categories
GET    /api/admin/categories/:id
PATCH  /api/admin/categories/:id
DELETE /api/admin/categories/:id
```

Recommended: use soft delete or `is_active = false` instead of hard delete.

## 12.4 Question APIs

```txt
GET    /api/admin/questions
POST   /api/admin/questions
GET    /api/admin/questions/:id
PATCH  /api/admin/questions/:id
DELETE /api/admin/questions/:id
```

Supported filters:

```txt
?categoryId=
?questionType=
?difficulty=
?isActive=
?search=
```

## 12.5 Upload APIs

```txt
POST /api/admin/uploads/question-image
```

Request:

- multipart/form-data
- field name: `image`

Response:

```json
{
  "imageUrl": "https://res.cloudinary.com/...",
  "publicId": "aviation-quiz/questions/..."
}
```

## 12.6 Analytics APIs

```txt
GET /api/admin/analytics/overview
GET /api/admin/analytics/categories
GET /api/admin/analytics/questions
GET /api/admin/analytics/groups
```

## 13. Quiz Engine Logic

## 13.1 Starting a Quiz

Input:

- User ID
- Chat ID
- Mode: private or group
- Category
- Number of questions
- Question type

Process:

1. Create or update user record
2. Create group record if group mode
3. Select random active questions from database
4. Create quiz session
5. Store selected questions in `quiz_session_questions`
6. Send first question

## 13.2 Selecting Questions

Simple query:

```sql
SELECT * FROM questions
WHERE is_active = true
AND category_id = $1
AND question_type = $2
ORDER BY random()
LIMIT $3;
```

For mixed categories or mixed types, conditions can be optional.

Important validation:

- If not enough questions exist, tell the user/admin
- Do not start quiz with fewer questions than requested unless user accepts fallback

## 13.3 Answer Checking

### Multiple Choice

The user taps an inline keyboard option.

The bot receives a callback query.

Check whether selected option has `is_correct = true`.

### Short Answer

The user sends text.

Version 1:

- Normalize text
- Lowercase
- Trim whitespace
- Compare against correct answer
- Optionally compare against accepted keywords

Example normalization:

```js
function normalizeAnswer(answer) {
  return answer
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
```

For keyword-based answers:

```js
function checkKeywords(answer, keywords) {
  const normalized = normalizeAnswer(answer);
  return keywords.every(keyword => normalized.includes(keyword.toLowerCase()));
}
```

## 13.4 Ending a Quiz

A quiz ends when:

- All questions are answered
- User cancels quiz
- Group admin ends quiz
- Group quiz timeout is reached

After completion:

- Calculate score
- Save final status
- Display summary
- Update leaderboard queries dynamically from `quiz_answers`, or maintain a cached leaderboard table later

## 14. Group Quiz Behavior

There are two possible group quiz styles.

### Style A: Fast Group Quiz

The bot posts one question to the group.

Everyone answers using inline buttons.

After time expires, the bot posts the correct answer and moves on.

Best for group competition.

### Style B: Individual Quiz Launched from Group

The bot posts a quiz invitation in the group.

Each user clicks `Start privately` and completes the quiz in DM.

Best for avoiding group spam.

Recommended Version 1:

Start with **Style B** because it is easier and cleaner.

Then add Style A later.

## 15. Admin Dashboard Pages

Recommended pages:

```txt
/login
/dashboard
/categories
/categories/new
/categories/:id/edit
/questions
/questions/new
/questions/:id/edit
/users
/groups
/analytics
/admins
```

## 16. Admin Dashboard UI Requirements

### Questions List

Should include:

- Search input
- Category filter
- Question type filter
- Difficulty filter
- Active/inactive filter
- Table of questions
- Edit button
- Archive button

Columns:

- Question preview
- Category
- Type
- Difficulty
- Has image
- Active
- Created date
- Actions

### Question Form

Fields:

- Category dropdown
- Question type dropdown
- Difficulty dropdown
- Question text textarea
- Image upload
- Options editor for multiple choice
- Correct answer field for short answer
- Accepted keywords field
- Explanation textarea
- Active toggle

Validation:

- Question text required
- Category required
- Question type required
- Multiple choice questions require at least 2 options
- Multiple choice questions require one correct option
- Short answer questions require correct answer or accepted keywords

## 17. Security Requirements

### Telegram Webhook Security

- Use HTTPS
- Use secret webhook URL or secret token
- Do not expose bot token in frontend
- Store bot token in environment variables

### Admin Dashboard Security

- Hash passwords with bcrypt
- Use JWT or secure cookies
- Protect all admin API routes
- Validate all inputs
- Rate limit login endpoint
- Restrict image file types and size
- Sanitize uploaded file names

### Environment Variables

```txt
DATABASE_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
JWT_SECRET=
ADMIN_FRONTEND_URL=
NODE_ENV=
PORT=
```

## 18. Project Folder Structure

Recommended Express backend structure:

```txt
backend/
  src/
    app.js
    server.js
    config/
      env.js
      db.js
      cloudinary.js
    bot/
      index.js
      handlers/
        start.handler.js
        quiz.handler.js
        leaderboard.handler.js
      keyboards/
        quiz.keyboards.js
      services/
        quiz.service.js
        scoring.service.js
        telegram-user.service.js
    modules/
      auth/
      categories/
      questions/
      uploads/
      analytics/
    middleware/
      auth.middleware.js
      error.middleware.js
      validate.middleware.js
    utils/
      normalize-answer.js
  prisma/
    schema.prisma
    migrations/
  package.json
```

Recommended frontend structure:

```txt
admin-dashboard/
  src/
    main.jsx
    App.jsx
    api/
      client.js
      auth.api.js
      categories.api.js
      questions.api.js
    pages/
      Login.jsx
      Dashboard.jsx
      Categories.jsx
      QuestionList.jsx
      QuestionForm.jsx
    components/
      Layout.jsx
      Table.jsx
      ImageUpload.jsx
      OptionEditor.jsx
    hooks/
      useAuth.js
    utils/
  package.json
```

## 19. Prisma Schema Draft

If using Prisma, the schema can look like this:

```prisma
enum QuestionType {
  multiple_choice
  short_answer
}

enum DifficultyLevel {
  easy
  medium
  hard
}

enum QuizMode {
  private
  group
}

enum QuizStatus {
  active
  completed
  cancelled
}

model User {
  id             String   @id @default(uuid())
  telegramUserId BigInt   @unique
  username       String?
  firstName      String?
  lastName       String?
  languageCode   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  quizSessions   QuizSession[]
  answers        QuizAnswer[]
}

model TelegramGroup {
  id             String   @id @default(uuid())
  telegramChatId BigInt   @unique
  title          String?
  type           String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  quizSessions   QuizSession[]
}

model Category {
  id           String   @id @default(uuid())
  name         String
  slug         String   @unique
  description  String?
  isActive     Boolean  @default(true)
  displayOrder Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  questions    Question[]
  quizzes      QuizSession[]
}

model Question {
  id                 String          @id @default(uuid())
  categoryId         String
  category           Category        @relation(fields: [categoryId], references: [id])
  questionText       String
  questionType       QuestionType
  difficulty         DifficultyLevel @default(medium)
  imageUrl           String?
  cloudinaryPublicId String?
  correctAnswerText  String?
  acceptedKeywords   String[]
  explanation        String?
  isActive           Boolean         @default(true)
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  options            QuestionOption[]
  quizQuestions      QuizSessionQuestion[]
  answers            QuizAnswer[]
}

model QuestionOption {
  id           String   @id @default(uuid())
  questionId   String
  question     Question @relation(fields: [questionId], references: [id], onDelete: Cascade)
  optionText   String
  isCorrect    Boolean  @default(false)
  displayOrder Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  answers      QuizAnswer[]
}

model QuizSession {
  id                   String      @id @default(uuid())
  mode                 QuizMode
  status               QuizStatus  @default(active)
  userId               String?
  user                 User?       @relation(fields: [userId], references: [id])
  groupId              String?
  group                TelegramGroup? @relation(fields: [groupId], references: [id])
  categoryId           String?
  category             Category?   @relation(fields: [categoryId], references: [id])
  questionType         QuestionType?
  totalQuestions       Int
  currentQuestionIndex Int         @default(0)
  startedAt            DateTime    @default(now())
  completedAt          DateTime?

  sessionQuestions     QuizSessionQuestion[]
  answers              QuizAnswer[]
}

model QuizSessionQuestion {
  id            String      @id @default(uuid())
  quizSessionId String
  quizSession   QuizSession @relation(fields: [quizSessionId], references: [id], onDelete: Cascade)
  questionId    String
  question      Question    @relation(fields: [questionId], references: [id])
  position      Int
  createdAt     DateTime    @default(now())
}

model QuizAnswer {
  id               String          @id @default(uuid())
  quizSessionId    String
  quizSession      QuizSession     @relation(fields: [quizSessionId], references: [id], onDelete: Cascade)
  questionId       String
  question         Question        @relation(fields: [questionId], references: [id])
  userId           String
  user             User            @relation(fields: [userId], references: [id])
  selectedOptionId String?
  selectedOption   QuestionOption? @relation(fields: [selectedOptionId], references: [id])
  answerText       String?
  isCorrect        Boolean
  pointsAwarded    Int             @default(0)
  answeredAt       DateTime        @default(now())
}

model Admin {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  role         String   @default("admin")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  auditLogs    AdminAuditLog[]
}

model AdminAuditLog {
  id         String   @id @default(uuid())
  adminId    String?
  admin      Admin?   @relation(fields: [adminId], references: [id])
  action     String
  entityType String?
  entityId   String?
  metadata   Json?
  createdAt  DateTime @default(now())
}
```

## 20. MVP Development Plan

## Phase 1 — Foundation

Build:

- Express server
- PostgreSQL connection
- Prisma setup
- Telegram bot setup
- Webhook endpoint
- `/start` command
- Basic user registration from Telegram

Deliverable:

A Telegram bot that responds to users and saves them in the database.

## Phase 2 — Question Bank

Build:

- Category model
- Question model
- Option model
- Seed sample aviation categories/questions
- Basic admin APIs

Deliverable:

Questions can be stored and fetched from Postgres.

## Phase 3 — Private Quiz

Build:

- Start quiz flow
- Category selection
- Number of questions selection
- Question type selection
- Multiple choice answers
- Short answer checking
- Score calculation

Deliverable:

A user can complete a full quiz privately.

## Phase 4 — Admin Dashboard

Build:

- Login page
- Dashboard layout
- Category CRUD
- Question CRUD
- Multiple choice option editor
- Cloudinary image upload

Deliverable:

Admins can manage the question bank without touching the database.

## Phase 5 — Group Mode

Build:

- Add bot to groups
- Register groups
- Group quiz command
- Group leaderboard
- Group quiz session handling

Deliverable:

Groups can run shared quizzes and see rankings.

## Phase 6 — Analytics and Polish

Build:

- Question success rate
- Category performance
- User stats
- Better leaderboard
- Admin audit logs
- Error handling
- Deployment hardening

Deliverable:

A stable product that can be used by real aviation students or enthusiasts.

## 21. Important Product Decisions

## 21.1 Should group quizzes happen in the group or privately?

Recommendation:

- Version 1: start quiz from group but answer privately
- Version 2: support live group quiz in the group

Reason:

Group chats can become noisy if every quiz interaction happens publicly.

## 21.2 Should short answers be exact or flexible?

Recommendation:

- Version 1: use exact answer plus keyword matching
- Version 2: add fuzzy matching
- Version 3: optionally use AI-assisted grading

## 21.3 Should leaderboard be stored or calculated?

Recommendation:

- Version 1: calculate from `quiz_answers`
- Later: cache leaderboard summaries if performance becomes an issue

## 21.4 Should admins be managed only from dashboard?

Recommendation:

Yes. Do not manage question bank through Telegram commands in Version 1.

The web dashboard will be easier, safer, and cleaner.

## 22. Sample Bot Messages

### Welcome

```txt
Welcome to Aviation Quiz Bot ✈️

Practice aviation topics, test your knowledge, and compete with others.

Choose an option below:
```

Buttons:

```txt
[ Start Quiz ]
[ My Stats ]
[ Leaderboard ]
[ Help ]
```

### Category Selection

```txt
Choose a category:
```

Buttons:

```txt
[ Aerodynamics ] [ Meteorology ]
[ Navigation ]   [ Air Law ]
[ Mixed ]
```

### Question

```txt
Question 3 of 10
Category: Aerodynamics

What are the four forces of flight?
```

### Correct Answer Feedback

```txt
Correct ✅

Explanation:
The four forces of flight are lift, weight, thrust, and drag.
```

### Wrong Answer Feedback

```txt
Not quite ❌

Correct answer:
Lift, weight, thrust, and drag.
```

### Final Score

```txt
Quiz complete ✈️

Score: 8/10
Accuracy: 80%
Category: Aerodynamics

Great work. Use /quiz to practice again.
```

## 23. Deployment Checklist

- Create Telegram bot through BotFather
- Get bot token
- Create PostgreSQL database
- Configure environment variables
- Deploy Express backend with HTTPS
- Set Telegram webhook
- Deploy admin dashboard
- Configure Cloudinary credentials
- Create first admin user
- Seed categories
- Add sample questions
- Test private quiz
- Test group invite
- Test image question
- Test scoring
- Test leaderboard

## 24. Suggested Package List

Backend:

```txt
express
grammy
@prisma/client
prisma
bcryptjs
jsonwebtoken
zod
multer
cloudinary
cors
helmet
express-rate-limit
dotenv
```

Frontend:

```txt
react
react-router-dom
axios
react-hook-form
zod
@hookform/resolvers
lucide-react
```

Optional UI libraries:

```txt
shadcn/ui
tailwindcss
```

## 25. Risks and Mitigations

### Risk: Group chats become spammy

Mitigation:

Start with private answer mode from group sessions.

### Risk: Short-answer grading is inaccurate

Mitigation:

Use multiple choice heavily in Version 1 and keep short-answer grading simple.

### Risk: Poor question quality

Mitigation:

Add explanations, difficulty levels, and admin review workflow later.

### Risk: Admin accidentally deletes important questions

Mitigation:

Use soft delete through `is_active = false` instead of hard delete.

### Risk: Not enough questions for selected category

Mitigation:

Before starting a quiz, check available question count and show a friendly error.

## 26. Recommended First Build

The best first build is:

- Telegram bot
- Express webhook
- Postgres with Prisma
- Private quiz mode
- Multiple choice questions only
- Simple admin dashboard for categories/questions
- Cloudinary image upload
- Basic leaderboard

Then add:

- Short answer questions
- Group quiz mode
- Analytics
- Advanced scoring

This avoids overbuilding while still creating a useful product quickly.

