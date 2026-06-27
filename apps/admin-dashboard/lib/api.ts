"use client"

export type QuestionType = "multiple_choice" | "short_answer"
export type Difficulty = "easy" | "medium" | "hard"

export type Category = {
  id: string
  name: string
  slug: string
  description: string | null
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export type QuestionOption = {
  id?: string
  optionText: string
  isCorrect: boolean
  displayOrder: number
}

export type Question = {
  id: string
  categoryId: string
  categoryName?: string | null
  questionText: string
  questionType: QuestionType
  difficulty: Difficulty
  imageUrl: string | null
  cloudinaryPublicId: string | null
  correctAnswerText: string | null
  acceptedKeywords: string[]
  explanation: string | null
  isActive: boolean
  options?: QuestionOption[]
  createdAt: string
  updatedAt: string
}

export type Overview = {
  totalQuestions: number
  totalCategories: number
  totalUsers: number
  totalQuizzesCompleted: number
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://tg-aviation-quiz-bot.onrender.com"

export function getApiUrl() {
  return API_URL.replace(/\/$/, "")
}

export function getToken() {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem("aviation_admin_token")
}

export function setToken(token: string) {
  window.localStorage.setItem("aviation_admin_token", token)
}

export function clearToken() {
  window.localStorage.removeItem("aviation_admin_token")
}

type ApiOptions = RequestInit & {
  token?: string | null
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}) {
  const token = options.token ?? getToken()
  const headers = new Headers(options.headers)

  if (!(options.body instanceof FormData)) {
    headers.set("content-type", "application/json")
  }
  if (token) headers.set("authorization", `Bearer ${token}`)

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed")
  }

  return payload as T
}

export const adminApi = {
  login: (input: { email: string; password: string }) =>
    apiRequest<{ token: string; admin: { id: string; email: string; role: string } }>(
      "/api/admin/auth/login",
      {
        method: "POST",
        body: JSON.stringify(input),
        token: null,
      }
    ),
  overview: () =>
    apiRequest<{ overview: Overview }>("/api/admin/analytics/overview"),
  categories: () =>
    apiRequest<{ categories: Category[] }>(
      "/api/admin/categories?includeInactive=true"
    ),
  createCategory: (input: Partial<Category>) =>
    apiRequest<{ category: Category }>("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCategory: (id: string, input: Partial<Category>) =>
    apiRequest<{ category: Category }>(`/api/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  archiveCategory: (id: string) =>
    apiRequest<{ category: Category }>(`/api/admin/categories/${id}`, {
      method: "DELETE",
    }),
  questions: (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params)
    const suffix = query.size ? `?${query.toString()}` : ""
    return apiRequest<{ questions: Question[] }>(`/api/admin/questions${suffix}`)
  },
  question: (id: string) =>
    apiRequest<{ question: Question }>(`/api/admin/questions/${id}`),
  createQuestion: (input: QuestionPayload) =>
    apiRequest<{ question: Question }>("/api/admin/questions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateQuestion: (id: string, input: Partial<QuestionPayload>) =>
    apiRequest<{ question: Question }>(`/api/admin/questions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  archiveQuestion: (id: string) =>
    apiRequest<{ question: Question }>(`/api/admin/questions/${id}`, {
      method: "DELETE",
    }),
  uploadQuestionImage: (file: File) => {
    const form = new FormData()
    form.append("image", file)
    return apiRequest<{ imageUrl: string; publicId: string }>(
      "/api/admin/uploads/question-image",
      {
        method: "POST",
        body: form,
      }
    )
  },
}

export type QuestionPayload = {
  categoryId: string
  questionText: string
  questionType: QuestionType
  difficulty: Difficulty
  imageUrl: string | null
  cloudinaryPublicId: string | null
  correctAnswerText: string | null
  acceptedKeywords?: string[]
  explanation: string | null
  isActive: boolean
  options?: QuestionOption[]
}
