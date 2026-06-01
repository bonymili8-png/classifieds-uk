# ОголошенняUK — мінімальний образ без зовнішніх залежностей.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Залежностей немає — копіюємо код напряму.
COPY . .

# Генеруємо PWA-іконки під час збірки (детерміновано, без мережі).
RUN node scripts/gen-icons.mjs

# Дані (база + завантаження) зберігаються у томах, щоб не губитися між рестартами.
VOLUME ["/app/data", "/app/public/uploads"]

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0

# Перевірка стану для оркестраторів.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
