# Octant is a client-only SPA: GitHub is the backend. The image builds the
# static bundle with bun, then throws the toolchain away and ships nothing but
# nginx and the contents of build/.

FROM oven/bun:1-alpine AS build
WORKDIR /app

# Dependencies first, so edits to src/ don't re-resolve the lockfile.
COPY package.json bun.lock .npmrc ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build


FROM nginx:1-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
