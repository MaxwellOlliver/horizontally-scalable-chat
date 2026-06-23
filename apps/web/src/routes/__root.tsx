import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { AuthContextValue } from '../lib/auth/types'

/** Context every route can read in `beforeLoad` — currently just auth. */
export interface RouterContext {
  auth: AuthContextValue
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
})
