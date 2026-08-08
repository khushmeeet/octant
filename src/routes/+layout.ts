// Client-only. There is no server of our own: the browser talks to
// api.github.com directly, so nothing is rendered or prerendered ahead of time.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
