import { createContext, useContext, useState, type ReactNode } from 'react'

type CategoryRecommendationsContextValue = {
  openCategory: string | null
  setOpenCategory: (category: string | null) => void
}

const CategoryRecommendationsContext = createContext<CategoryRecommendationsContextValue | null>(null)

export function CategoryRecommendationsProvider({ children }: { children: ReactNode }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  return (
    <CategoryRecommendationsContext.Provider value={{ openCategory, setOpenCategory }}>{children}</CategoryRecommendationsContext.Provider>
  )
}

export function useCategoryRecommendationsContext(): CategoryRecommendationsContextValue {
  const ctx = useContext(CategoryRecommendationsContext)
  if (!ctx) throw new Error('useCategoryRecommendationsContext must be used within a CategoryRecommendationsProvider')
  return ctx
}
