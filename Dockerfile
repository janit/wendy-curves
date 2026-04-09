FROM denoland/deno:2.7.9 AS build

WORKDIR /app

COPY deno.json deno.lock* ./
RUN deno install --allow-scripts

COPY . .
RUN deno task build

FROM denoland/deno:2.7.9

WORKDIR /app

COPY --from=build /app/_fresh _fresh/
COPY --from=build /app/deno.json /app/deno.lock* ./
COPY --from=build /app/serve.ts .
COPY --from=build /app/lib lib/
COPY --from=build /app/static static/
COPY --from=build /app/node_modules node_modules/

ARG GIT_HASH=dev
ENV WENDY_CURVES_VERSION=$GIT_HASH

RUN mkdir -p /app/data
ENV WENDY_CURVES_DB_PATH=/app/data/wendy-curves.db

EXPOSE 8087

CMD ["deno", "run", "-A", "serve.ts"]
