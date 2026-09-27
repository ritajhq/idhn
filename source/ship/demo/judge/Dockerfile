FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=judge/server main.js main.js
COPY policy.wasm policies.yaml /config/

EXPOSE 8081

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "main.js"]
