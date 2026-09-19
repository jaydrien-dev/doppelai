FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
ENV PORT=8080
ENV DOPPEL_SERVER_DATA=/data
EXPOSE 8080
CMD ["node", "index.js"]
