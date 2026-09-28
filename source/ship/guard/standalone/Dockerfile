FROM denoland/deno:alpine-2.9.3

WORKDIR /app

COPY --from=guard/standalone main.js ./main.js

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "/app/main.js"]

EXPOSE 8080
