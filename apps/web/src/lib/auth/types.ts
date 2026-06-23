/** What the client knows about the signed-in user. id comes from the JWT `sub`. */
export interface Profile {
  id: string
  email?: string
  displayName?: string
}

/** The persisted auth session: the token pair plus a display profile. */
export interface Session {
  accessToken: string
  refreshToken: string
  profile: Profile
}

/** The value exposed through React context + the router's `beforeLoad` guards. */
export interface AuthContextValue {
  session: Session | null
  isAuthenticated: boolean
  user: Profile | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
}
