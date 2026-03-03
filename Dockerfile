# Stage 1 — Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ pkgconfig pixman-dev cairo-dev pango-dev libjpeg-turbo-dev giflib-dev
RUN npm install
COPY . .
RUN node scripts/generate-map.mjs
RUN npm run build

# Stage 2 — Serve
FROM nginx:1.25-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
