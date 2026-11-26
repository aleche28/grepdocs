import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { renderRoute } from '../test/renderRoute.tsx'
import { NotFoundPage } from './NotFoundPage.tsx'

describe('NotFoundPage', () => {
  test('says so, with the way back', () => {
    renderRoute({ path: '*', element: <NotFoundPage />, url: '/nowhere' })

    expect(
      screen.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to your repositories' }),
    ).toHaveAttribute('href', '/')
  })
})
