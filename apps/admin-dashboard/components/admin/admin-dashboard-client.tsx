"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  ImageIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  adminApi,
  type Category,
  type Difficulty,
  type Overview,
  type Question,
  type QuestionOption,
  type QuestionPayload,
  type QuestionType,
} from "@/lib/api"

type View = "overview" | "categories" | "questions"

const emptyCategory = {
  name: "",
  slug: "",
  description: "",
  displayOrder: 0,
  isActive: true,
}

const defaultOptions: QuestionOption[] = [
  { optionText: "", isCorrect: true, displayOrder: 0 },
  { optionText: "", isCorrect: false, displayOrder: 1 },
  { optionText: "", isCorrect: false, displayOrder: 2 },
  { optionText: "", isCorrect: false, displayOrder: 3 },
]

const emptyQuestion: QuestionPayload = {
  categoryId: "",
  questionText: "",
  questionType: "multiple_choice",
  difficulty: "medium",
  imageUrl: null,
  cloudinaryPublicId: null,
  correctAnswerText: "",
  acceptedKeywords: [],
  explanation: "",
  isActive: true,
  options: defaultOptions,
}

export function AdminDashboardClient() {
  const router = useRouter()
  const [activeView, setActiveView] = useState<View>("overview")
  const [overview, setOverview] = useState<Overview | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [questionSearch, setQuestionSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")

  async function loadData() {
    setError("")
    setIsLoading(true)
    try {
      const [overviewResponse, categoriesResponse, questionsResponse] =
        await Promise.all([
          adminApi.overview(),
          adminApi.categories(),
          adminApi.questions({ isActive: "true" }),
        ])
      setOverview(overviewResponse.overview)
      setCategories(categoriesResponse.categories)
      setQuestions(questionsResponse.questions)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load"
      if (message.toLowerCase().includes("token")) router.replace("/login")
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!window.localStorage.getItem("aviation_admin_token")) {
      router.replace("/login")
      return
    }
    void loadData()
  }, [])

  const filteredQuestions = useMemo(() => {
    return questions.filter((question) => {
      const matchesCategory =
        categoryFilter === "all" || question.categoryId === categoryFilter
      const matchesSearch =
        !questionSearch ||
        question.questionText
          .toLowerCase()
          .includes(questionSearch.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }, [questions, questionSearch, categoryFilter])

  return (
    <SidebarProvider>
      <AppSidebar activeView={activeView} onViewChange={setActiveView} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background px-4">
          <SidebarTrigger />
          <div>
            <h1 className="font-heading text-base font-semibold">
              Admin Dashboard
            </h1>
            <p className="text-xs text-muted-foreground">
              Categories, questions, and optional image-backed quiz content
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={loadData}
            disabled={isLoading}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {isLoading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Loading admin data
            </div>
          ) : null}
          {!isLoading && activeView === "overview" ? (
            <OverviewPanel overview={overview} categories={categories} questions={questions} />
          ) : null}
          {!isLoading && activeView === "categories" ? (
            <CategoriesPanel categories={categories} onChanged={loadData} />
          ) : null}
          {!isLoading && activeView === "questions" ? (
            <QuestionsPanel
              categories={categories}
              questions={filteredQuestions}
              questionSearch={questionSearch}
              setQuestionSearch={setQuestionSearch}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              onChanged={loadData}
            />
          ) : null}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function OverviewPanel({
  overview,
  categories,
  questions,
}: {
  overview: Overview | null
  categories: Category[]
  questions: Question[]
}) {
  const activeQuestions = questions.filter((question) => question.isActive).length
  const imageQuestions = questions.filter((question) => question.imageUrl).length

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Questions" value={overview?.totalQuestions ?? activeQuestions} />
      <MetricCard label="Categories" value={overview?.totalCategories ?? categories.length} />
      <MetricCard label="Users" value={overview?.totalUsers ?? 0} />
      <MetricCard label="Image questions" value={imageQuestions} />
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function CategoriesPanel({
  categories,
  onChanged,
}: {
  categories: Category[]
  onChanged: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold">Categories</h2>
          <p className="text-sm text-muted-foreground">
            Control what appears in the Telegram quiz setup.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setIsOpen(true)
          }}
        >
          <PlusIcon />
          Category
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>
                    <div className="font-medium">{category.name}</div>
                    <div className="max-w-xl truncate text-xs text-muted-foreground">
                      {category.description || "No description"}
                    </div>
                  </TableCell>
                  <TableCell>{category.slug}</TableCell>
                  <TableCell>
                    <Badge variant={category.isActive ? "default" : "secondary"}>
                      {category.isActive ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(category)
                        setIsOpen(true)
                      }}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <CategoryDialog
        open={isOpen}
        category={editing}
        onOpenChange={setIsOpen}
        onChanged={onChanged}
      />
    </div>
  )
}

function CategoryDialog({
  open,
  category,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  category: Category | null
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const [form, setForm] = useState(emptyCategory)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setForm(
      category
        ? {
            name: category.name,
            slug: category.slug,
            description: category.description ?? "",
            displayOrder: category.displayOrder,
            isActive: category.isActive,
          }
        : emptyCategory
    )
  }, [category, open])

  async function save() {
    setIsSaving(true)
    const payload = {
      ...form,
      description: form.description || null,
    }
    try {
      if (category) await adminApi.updateCategory(category.id, payload)
      else await adminApi.createCategory(payload)
      await onChanged()
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  async function archive() {
    if (!category) return
    setIsSaving(true)
    try {
      await adminApi.archiveCategory(category.id)
      await onChanged()
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "Create category"}</DialogTitle>
          <DialogDescription>
            Active categories are visible to Telegram users.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormInput label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <FormInput label="Slug" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} />
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </div>
          <FormInput
            label="Display order"
            type="number"
            value={String(form.displayOrder)}
            onChange={(displayOrder) =>
              setForm({ ...form, displayOrder: Number(displayOrder) })
            }
          />
          <SwitchRow
            label="Active"
            checked={form.isActive}
            onCheckedChange={(isActive) => setForm({ ...form, isActive })}
          />
          <div className="flex justify-between gap-2">
            {category ? (
              <Button variant="outline" onClick={archive} disabled={isSaving}>
                <ArchiveIcon />
                Archive
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={save} disabled={isSaving}>
              <SaveIcon />
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function QuestionsPanel({
  categories,
  questions,
  questionSearch,
  setQuestionSearch,
  categoryFilter,
  setCategoryFilter,
  onChanged,
}: {
  categories: Category[]
  questions: Question[]
  questionSearch: string
  setQuestionSearch: (value: string) => void
  categoryFilter: string
  setCategoryFilter: (value: string) => void
  onChanged: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)
  const [loadingQuestionId, setLoadingQuestionId] = useState<string | null>(null)

  async function editQuestion(question: Question) {
    setLoadingQuestionId(question.id)
    try {
      const response = await adminApi.question(question.id)
      setEditing(response.question)
      setIsOpen(true)
    } finally {
      setLoadingQuestionId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold">Questions</h2>
          <p className="text-sm text-muted-foreground">
            Manage multiple-choice, short-answer, and image-backed questions.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8 sm:w-64"
              value={questionSearch}
              onChange={(event) => setQuestionSearch(event.target.value)}
              placeholder="Search questions"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              setEditing(null)
              setIsOpen(true)
            }}
          >
            <PlusIcon />
            Question
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Image</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.map((question) => (
                <TableRow key={question.id}>
                  <TableCell>
                    <div className="max-w-xl whitespace-normal font-medium">
                      {question.questionText}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {question.difficulty} · {question.isActive ? "active" : "archived"}
                    </div>
                  </TableCell>
                  <TableCell>{question.categoryName ?? "Unknown"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {question.questionType === "multiple_choice" ? "MCQ" : "Short"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {question.imageUrl ? <ImageIcon className="size-4" /> : "None"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={loadingQuestionId === question.id}
                      onClick={() => void editQuestion(question)}
                    >
                      {loadingQuestionId === question.id ? "Loading" : "Edit"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <QuestionDialog
        open={isOpen}
        question={editing}
        categories={categories}
        onOpenChange={setIsOpen}
        onChanged={onChanged}
      />
    </div>
  )
}

function QuestionDialog({
  open,
  question,
  categories,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  question: Question | null
  categories: Category[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const [form, setForm] = useState<QuestionPayload>(emptyQuestion)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(
      question
        ? {
            categoryId: question.categoryId,
            questionText: question.questionText,
            questionType: question.questionType,
            difficulty: question.difficulty,
            imageUrl: question.imageUrl,
            cloudinaryPublicId: question.cloudinaryPublicId,
            correctAnswerText: question.correctAnswerText,
            acceptedKeywords: question.acceptedKeywords,
            explanation: question.explanation,
            isActive: question.isActive,
            options: question.options?.length ? question.options : defaultOptions,
          }
        : {
            ...emptyQuestion,
            categoryId: categories[0]?.id ?? "",
            options: defaultOptions.map((option) => ({ ...option })),
          }
    )
  }, [question, open, categories])

  function setQuestionType(questionType: QuestionType) {
    setForm({
      ...form,
      questionType,
      options:
        questionType === "multiple_choice"
          ? form.options?.length
            ? form.options
            : defaultOptions
          : undefined,
    })
  }

  async function upload(file: File | null) {
    if (!file) return
    setIsUploading(true)
    try {
      const response = await adminApi.uploadQuestionImage(file)
      setForm({
        ...form,
        imageUrl: response.imageUrl,
        cloudinaryPublicId: response.publicId,
      })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function save() {
    setIsSaving(true)
    try {
      const payload = normalizeQuestionPayload(form)
      if (question) await adminApi.updateQuestion(question.id, payload)
      else await adminApi.createQuestion(payload)
      await onChanged()
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  async function archive() {
    if (!question) return
    setIsSaving(true)
    try {
      await adminApi.archiveQuestion(question.id)
      await onChanged()
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{question ? "Edit question" : "Create question"}</DialogTitle>
          <DialogDescription>
            Images are optional for every question. Upload one or paste a URL.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={form.categoryId}
                onValueChange={(categoryId) => setForm({ ...form, categoryId })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={form.questionType} onValueChange={setQuestionType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                  <SelectItem value="short_answer">Short answer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Difficulty</Label>
              <Select
                value={form.difficulty}
                onValueChange={(difficulty) =>
                  setForm({ ...form, difficulty: difficulty as Difficulty })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Question text</Label>
            <Textarea
              value={form.questionText}
              onChange={(event) =>
                setForm({ ...form, questionText: event.target.value })
              }
              rows={4}
            />
          </div>
          <div className="grid gap-2">
            <Label>Image URL</Label>
            <div className="flex gap-2">
              <Input
                value={form.imageUrl ?? ""}
                onChange={(event) =>
                  setForm({ ...form, imageUrl: event.target.value || null })
                }
                placeholder="Optional"
              />
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(event) =>
                  void upload(event.target.files?.[0] ?? null)
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon />
                {isUploading ? "Uploading" : "Upload"}
              </Button>
            </div>
            {form.imageUrl ? (
              <div className="flex items-center gap-3 rounded-md border p-2">
                <img
                  src={form.imageUrl}
                  alt=""
                  className="h-14 w-20 rounded object-cover"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      imageUrl: null,
                      cloudinaryPublicId: null,
                    })
                  }
                >
                  Remove image
                </Button>
              </div>
            ) : null}
          </div>
          {form.questionType === "multiple_choice" ? (
            <OptionEditor
              options={form.options ?? defaultOptions}
              onChange={(options) => setForm({ ...form, options })}
            />
          ) : (
            <div className="grid gap-2">
              <Label>Accepted keywords</Label>
              <Input
                value={(form.acceptedKeywords ?? []).join(", ")}
                onChange={(event) =>
                  setForm({
                    ...form,
                    acceptedKeywords: event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="lift, weight, thrust, drag"
              />
            </div>
          )}
          <FormInput
            label="Correct answer"
            value={form.correctAnswerText ?? ""}
            onChange={(correctAnswerText) =>
              setForm({ ...form, correctAnswerText })
            }
          />
          <div className="grid gap-2">
            <Label>Explanation</Label>
            <Textarea
              value={form.explanation ?? ""}
              onChange={(event) =>
                setForm({ ...form, explanation: event.target.value })
              }
              rows={3}
            />
          </div>
          <SwitchRow
            label="Active"
            checked={form.isActive}
            onCheckedChange={(isActive) => setForm({ ...form, isActive })}
          />
          <div className="flex justify-between gap-2">
            {question ? (
              <Button variant="outline" onClick={archive} disabled={isSaving}>
                <ArchiveIcon />
                Archive
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={save} disabled={isSaving || !form.categoryId}>
              <SaveIcon />
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OptionEditor({
  options,
  onChange,
}: {
  options: QuestionOption[]
  onChange: (options: QuestionOption[]) => void
}) {
  function update(index: number, option: QuestionOption) {
    onChange(options.map((item, itemIndex) => (itemIndex === index ? option : item)))
  }

  function markCorrect(index: number) {
    onChange(
      options.map((option, itemIndex) => ({
        ...option,
        isCorrect: itemIndex === index,
      }))
    )
  }

  return (
    <div className="grid gap-2">
      <Label>Options</Label>
      <div className="grid gap-2">
        {options.map((option, index) => (
          <div key={index} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1fr_auto]">
            <Input
              value={option.optionText}
              onChange={(event) =>
                update(index, { ...option, optionText: event.target.value })
              }
              placeholder={`Option ${index + 1}`}
            />
            <Button
              type="button"
              variant={option.isCorrect ? "default" : "outline"}
              onClick={() => markCorrect(index)}
            >
              Correct
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function normalizeQuestionPayload(form: QuestionPayload): QuestionPayload {
  return {
    ...form,
    imageUrl: form.imageUrl || null,
    cloudinaryPublicId: form.cloudinaryPublicId || null,
    correctAnswerText: form.correctAnswerText || null,
    explanation: form.explanation || null,
    options:
      form.questionType === "multiple_choice"
        ? (form.options ?? defaultOptions).map((option, index) => ({
            optionText: option.optionText,
            isCorrect: option.isCorrect,
            displayOrder: index,
          }))
        : undefined,
  }
}

function FormInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
