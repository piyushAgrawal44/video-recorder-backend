import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import fs from "fs";
import path from "path";
import registerSocketHandlers from "./socketHandlers";
import recordingsRoutes from "./routes/recording";
import dotenv from "dotenv";
dotenv.config();
const OUTPUT_DIR = "uploads";
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 50 * 1024 * 1024
});

// Middleware & Routes
app.use(cors());
app.use("/recordings", recordingsRoutes);

// Live stream list endpoint
const liveStreams: Record<string, { socketId: string; startedAt: number }> = {};
app.get("/live-streams", (req, res) => {
  const streams = Object.values(liveStreams);
  res.json({ streams });
});

// Socket logic
registerSocketHandlers(io, liveStreams);

server.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
  console.log(`📁 Saving recordings to ${path.resolve(OUTPUT_DIR)}`);
});
