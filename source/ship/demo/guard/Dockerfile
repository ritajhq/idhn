FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=guard/standalone main.js main.js
COPY manifest.yaml forbidden.html /config/

EXPOSE 8080

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "main.js"]
