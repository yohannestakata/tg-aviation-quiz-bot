# Admin Dashboard

Next.js + shadcn admin surface for the aviation quiz backend.

Current scope:

- Admin login
- Overview metrics
- Category create/edit/archive
- Question create/edit/archive
- Multiple-choice option editor
- Short-answer accepted keywords
- Optional image URL or Cloudinary upload for every question

Run locally:

```bash
NEXT_PUBLIC_API_URL=https://tg-aviation-quiz-bot.onrender.com bun dev
```

The dashboard stores the admin JWT in local storage.
