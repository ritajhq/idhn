FROM denoland/deno:alpine-2.9.3

WORKDIR /app

COPY --from=artifacts judge/server/main.js ./main.js

CMD ["deno", "run", "--unstable-kv", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "/app/main.js"]

EXPOSE 8081
