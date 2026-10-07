FROM denoland/deno:alpine-2.9.3

WORKDIR /app

COPY --from=console/server main.js ./main.js
COPY --from=console/web index.html main.js index.css ./web/

ENV CONSOLE_DIST=/app/web

# The console's SQLite file (resources and policy sources): mount a volume here.
VOLUME /var/lib/idhn-console

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "/app/main.js"]

EXPOSE 8084
