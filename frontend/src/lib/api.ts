import type { Recipe, RecipeCreate, RecipeUpdate } from './types'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${detail}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  recipes: {
    list: () => req<Recipe[]>('GET', '/recipes'),
    get: (id: number) => req<Recipe>('GET', `/recipes/${id}`),
    create: (data: RecipeCreate) => req<Recipe>('POST', '/recipes', data),
    update: (id: number, data: RecipeUpdate) => req<Recipe>('PUT', `/recipes/${id}`, data),
    delete: (id: number) => req<void>('DELETE', `/recipes/${id}`),
  },
  sessions: {
    start: (recipeId: number) => req<{ run_id: number }>('POST', '/sessions', { recipe_id: recipeId }),
    stop: () => req<void>('DELETE', '/sessions/current'),
  },
  runs: {
    list: () => req<{ id: number; recipe_name: string; status: string; created_at: string; passed: number; failed: number }[]>('GET', '/runs'),
  },
}
