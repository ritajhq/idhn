FROM denoland/deno:alpine-2.9.3

WORKDIR /app

COPY --from=audit/server main.js ./main.js

# The audit's SQLite file: mount a volume here to keep it across restarts.
VOLUME /var/lib/idhn-audit

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "/app/main.js"]

EXPOSE 8083
