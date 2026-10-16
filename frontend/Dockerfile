FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=http://localhost:5000/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG VITE_ENABLE_SERVER_WORKSPACE=false
ENV VITE_ENABLE_SERVER_WORKSPACE=$VITE_ENABLE_SERVER_WORKSPACE
# Generation remains disabled unless a separate experimental image opts in.
ARG VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=false
ENV VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=$VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM
ARG VITE_PUBLIC_SITE_URL=
ENV VITE_PUBLIC_SITE_URL=$VITE_PUBLIC_SITE_URL

RUN npm run build

FROM nginx:1.29-alpine
ARG VITE_ENABLE_SERVER_WORKSPACE=false
ENV TRUSTED_EDGE_CIDR=127.0.0.1/32

RUN apk upgrade --no-cache

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY nginx.local.conf /etc/nginx/local-workspace.conf
RUN if [ "$VITE_ENABLE_SERVER_WORKSPACE" != "true" ]; then cp /etc/nginx/local-workspace.conf /etc/nginx/conf.d/default.conf; rm /etc/nginx/templates/default.conf.template; fi
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
