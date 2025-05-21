import { Server } from "socket.io";
import http from "http";
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";

const app = express();
const server = http.createServer(app);
interface LiveStream {
  socketId: string;
  startedAt: number;
}


interface Room {
  broadcaster: string;
  chunks: Buffer[];
}

const rooms: Record<string, Room> = {};

const liveStreams: { [socketId: string]: LiveStream } = {};

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 50 * 1024 * 1024 // Increasing max buffer size to 50MB
});

const OUTPUT_DIR = "uploads";
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Track recordings with more metadata
interface RecordingState {
  stream: fs.WriteStream;
  filename: string;
  startTime: number;
  chunkCount: number;
  hasHeader: boolean;
}



const recordings: { [socketId: string]: RecordingState } = {};

io.on("connection", (socket) => {
  console.log("✅ New client connected: ", socket.id);

  setTimeout(() => {
    console.log("Message sent to client: ", socket.id);
    socket.emit("message", { text: "This is a live backend message!" + Math.random() });
  }, 5000);

  liveStreams[socket.id] = {
    socketId: socket.id,
    startedAt: Date.now()
  };


  // Handle the first chunk that contains important WebM header information
  socket.on("recording-start", () => {
    try {
      const timestamp = Date.now();
      const filename = `recording_${socket.id}_${timestamp}.webm`;
      const filePath = path.join(OUTPUT_DIR, filename);

      console.log(`Starting new recording for ${socket.id} at ${filePath}`);

      // Create write stream for binary data
      const stream = fs.createWriteStream(filePath, {
        flags: 'w',
        encoding: 'binary'
      });

      // Set up error handling for the stream
      stream.on('error', (err) => {
        console.error(`Error with stream for ${socket.id}:`, err);
      });

      // Store recording state
      recordings[socket.id] = {
        stream,
        filename,
        startTime: timestamp,
        chunkCount: 0,
        hasHeader: false
      };

      rooms[socket.id] = {
        broadcaster: socket.id,
        chunks: []
      };

    } catch (err) {
      console.error("Error starting recording:", err);
    }
  });

  // Handle subsequent video chunks
  socket.on("video-chunk", (chunk) => {
    try {
      const recording = recordings[socket.id];
      if (!recording) {
        console.warn(`Received chunk but no active recording for ${socket.id}`);
        return;
      }

      const buffer = Buffer.from(chunk);
      recording.stream.write(buffer);
      recording.chunkCount++;

      const streamRoom = socket.id; // use socket.id as stream room name
      io.to(streamRoom).emit("video-chunk", buffer);

      // Log periodically, not for every chunk to reduce console spam
      if (recording.chunkCount % 50 === 0) {
        console.log(`Received chunk ${recording.chunkCount} (${buffer.length} bytes) for ${socket.id}`);
      }
    } catch (err) {
      console.error(`Error processing video chunk for ${socket.id}:`, err);
    }
  });

  // Handle recording stop event
  socket.on("recording-stopped", () => {
    try {
      const recording = recordings[socket.id];
      if (!recording) {
        console.warn(`Received stop signal but no active recording for ${socket.id}`);
        return;
      }

      // Ensure all data is flushed to disk
      recording.stream.end(() => {
        console.log(`Recording completed for ${socket.id}: ${recording.filename}`);
        console.log(`Total chunks: ${recording.chunkCount}, Duration: ${(Date.now() - recording.startTime) / 1000}s`);

        // Verify file was created and has content
        const filePath = path.join(OUTPUT_DIR, recording.filename);
        fs.stat(filePath, (err, stats) => {
          if (err) {
            console.error(`Error accessing saved file: ${err.message}`);
          } else {
            console.log(`File size: ${stats.size} bytes`);

            // Notify client that recording was saved
            socket.emit("recording-saved", {
              filename: recording.filename,
              size: stats.size,
              duration: (Date.now() - recording.startTime) / 1000
            });
          }
        });
      });

      delete recordings[socket.id];
    } catch (err) {
      console.error(`Error stopping recording for ${socket.id}:`, err);
    }
  });





  // Join a live stream room for chat
  socket.on("join-stream", (streamId) => {
    socket.join(streamId);
    console.log(`${socket.id} joined stream chat: ${streamId}`);
  });

  // Broadcast chat message to stream room
  socket.on("stream-chat", ({ streamId, message }) => {
    io.to(streamId).emit("message", { text: "AI: " + message });
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    // Remove from live stream list
    delete liveStreams[socket.id];

    const recording = recordings[socket.id];
    if (recording) {
      try {
        // Close stream properly
        recording.stream.end(() => {
          console.log(`Cleaned up recording for disconnected client ${socket.id}`);
        });
        delete recordings[socket.id];
      } catch (err) {
        console.error(`Error cleaning up recording for ${socket.id}:`, err);
      }
    }
  });
});


app.get('/recordings', cors(), async (req, res) => {
  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    const webmFiles = files.filter(file => file.endsWith('.webm'));

    const recordingsWithMeta = await Promise.all(webmFiles.map(async (filename) => {
      const filePath = path.join(OUTPUT_DIR, filename);
      const stats = await fs.promises.stat(filePath);
      const timestampMatch = filename.match(/_(\d+)\.webm$/);
      const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : Date.now();

      return {
        filename,
        size: stats.size,
        timestamp,
        url: `/recordings/${filename}`
      };
    }));

    res.json({ recordings: recordingsWithMeta });
  } catch (err) {
    console.error('Failed to list recordings:', err);
    res.status(500).json({ error: 'Could not read recordings directory' });
  }
});

app.get('/recordings/:filename', cors(), (req, res) :any => {
  const filename = req.params.filename;
  const filePath = path.join(OUTPUT_DIR, filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  // Set appropriate headers (e.g., for streaming video)
  res.setHeader('Content-Type', 'video/webm');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

  // Create read stream and pipe it to the response
  const readStream = fs.createReadStream(filePath);
  readStream.pipe(res);
});


app.get('/live-streams', cors(), (req, res) => {
  const streams = Object.values(liveStreams).map(stream => ({
    socketId: stream.socketId,
    startedAt: stream.startedAt
  }));
  res.json({ streams });
});


server.listen(4000, () => {
  console.log("🚀 Backend running on http://localhost:4000");
  console.log(`📁 Recordings will be saved to: ${path.resolve(OUTPUT_DIR)}`);
});