<div align="center">
  <img alt="Wally" src="https://img.shields.io/badge/Wally-Salary%20Manager-14b8a6?style=flat-square&labelColor=0f172a" />
  <h1 align="center">Wally</h1>
  <p align="center">
    Track monthly salary splits, spending, savings, and yearly totals — all in COP.
  </p>
  <p align="center">
    <a href="#features">Features</a> ·
    <a href="#tech-stack">Tech Stack</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#usage">Usage</a>
  </p>
</div>

<br />

Wally is a personal finance dashboard built with **Next.js** and **Supabase**. It helps you distribute your monthly salary across custom budget sections (e.g. Essentials, Savings, Lifestyle, Buffer), log every expense, saving, transfer, or adjustment, and see your money flow across months and years.

---

## Features

- **Monthly salary tracking** — Record your salary each month in Colombian Pesos (COP).
- **Custom budget sections** — Create, rename, and rearrange percentage-based buckets. Defaults to the classic 50/20/20/10 rule.
- **Carry-over logic** — Unused money rolls into the next month automatically, section by section.
- **Transaction logging** — Log expenses, savings, transfers, and adjustments per section.
- **Yearly overview** — See month-by-month summaries and full-year totals.
- **Authentication** — Powered by Supabase Auth with email/password sign-up and login.
- **Dark & light mode** — Theme switching via `next-themes`.
- **Responsive** — Works on mobile and desktop.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js](https://nextjs.org/) (App Router) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| UI Components | [shadcn/ui](https://ui.shadcn.com/) (Radix primitives) |
| Backend / Auth | [Supabase](https://supabase.com/) |
| Language | TypeScript |
| Package Manager | [Bun](https://bun.sh/) |

---

## Getting Started

### Prerequisites

- A [Supabase](https://supabase.com/) project
- Node.js 18+ or Bun

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/wally.git
   cd wally
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env.local` and fill in your Supabase project credentials:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
   ```

4. **Run the development server**

   ```bash
   bun run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

### Database Setup

Wally expects three tables in your Supabase database. Create them in the Supabase SQL editor:

```sql
CREATE TABLE salary_months (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id),
  month     DATE NOT NULL,
  salary_cop INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, month)
);

CREATE TABLE salary_sections (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  month_id   UUID NOT NULL REFERENCES salary_months(id),
  name       TEXT NOT NULL,
  percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE salary_transactions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  month_id    UUID NOT NULL REFERENCES salary_months(id),
  section_id  UUID REFERENCES salary_sections(id),
  kind        TEXT NOT NULL CHECK (kind IN ('expense', 'saving', 'transfer', 'adjustment')),
  amount_cop  INTEGER NOT NULL,
  note        TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> Enable **Row Level Security** on all three tables and create policies so users can only access their own rows. The Supabase client in this project expects RLS to be active.

---

## Usage

1. **Sign up** or **log in** with your email.
2. **Select a month** from the dropdown and enter your salary.
3. **Adjust the sections** — rename them, change percentages, or add new ones.
4. **Save the plan** — this persists the month and its sections to Supabase.
5. **Log transactions** — add expenses, savings, transfers, or adjustments against any section.
6. **View the year tab** — see how each month's salary was distributed, spent, and saved.

---

## Project Structure

```
app/
├── auth/             # Sign-up, login, password reset pages
├── protected/        # Authenticated layout wrapper
├── layout.tsx        # Root layout with ThemeProvider
└── page.tsx          # Home page → SalaryDashboard
components/
├── salary-dashboard.tsx   # Main dashboard component
├── ui/                    # shadcn/ui primitives
└── ...                    # Auth forms, theme switcher, etc.
lib/
└── supabase/              # Client, server, and proxy helpers
proxy.ts                   # Session refresh middleware
```

---

## License

MIT
