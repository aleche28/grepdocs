import { setupServer } from 'msw/node'

// The mock API for every test. It starts with no handlers: each test declares
// the endpoints it needs with server.use(...), and setup.ts fails any request
// nobody declared, so a test cannot pass on a request it did not expect.
//
// Handlers take paths built with apiUrl() (relative, like the app's own
// requests), which MSW resolves against jsdom's location.
export const server = setupServer()
