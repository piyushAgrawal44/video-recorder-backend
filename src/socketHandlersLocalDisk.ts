import fs from "fs";
import path from "path";
import { Server, Socket } from "socket.io";

interface RecordingState {
    stream: fs.WriteStream;
    filename: string;
    startTime: number;
    chunkCount: number;
}

export default function registerSocketHandlers(
    io: Server,
    liveStreams: Record<string, { socketId: string; startedAt: number }>,
    OUTPUT_DIR: string
) {
    const recordings: Record<string, RecordingState> = {};

    io.on("connection", (socket: Socket) => {
        console.log(`✅ Connected: ${socket.id}`);

        liveStreams[socket.id] = {
            socketId: socket.id,
            startedAt: Date.now()
        };

        socket.join(socket.id)
        socket.on("recording-start", () => {
            const timestamp = Date.now();
            const filename = `recording_${socket.id}_${timestamp}.webm`;
            const filePath = path.join(OUTPUT_DIR, filename);

            const stream = fs.createWriteStream(filePath, { flags: "w", encoding: "binary" });

            recordings[socket.id] = {
                stream,
                filename,
                startTime: timestamp,
                chunkCount: 0
            };

            console.log(`▶️ Started recording for ${socket.id}`);
        });

        socket.on("video-chunk", (chunk) => {
            const recording = recordings[socket.id];
            if (!recording) return;

            const buffer = Buffer.from(chunk);
            recording.stream.write(buffer);
            recording.chunkCount++;
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            io.to(socket.id).emit("live-stream-video-chunk", arrayBuffer);
        });

        socket.on("recording-stopped", () => {
            const recording = recordings[socket.id];
            if (!recording) return;

            recording.stream.end(() => {
                const filePath = path.join(OUTPUT_DIR, recording.filename);
                const duration = (Date.now() - recording.startTime) / 1000;

                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        console.error("Error reading file:", err);
                        return;
                    }

                    socket.emit("recording-saved", {
                        filename: recording.filename,
                        size: stats.size,
                        duration
                    });

                    console.log(`✅ Saved ${recording.filename} (${stats.size} bytes)`);
                });
            });

            delete recordings[socket.id];
        });

        socket.on("join-room", (streamId) => {
            socket.join(streamId);
        });

        socket.on("stream-chat", ({ streamId, message }) => {
            io.to(streamId).emit("message", { text: "AI: " + message }); // emit to all user including sender
        });

        socket.on("disconnect", () => {
            console.log("❌ Disconnected:", socket.id);
            delete liveStreams[socket.id];

            const recording = recordings[socket.id];
            if (recording) {
                recording.stream.end();
                delete recordings[socket.id];
            }
        });
    });
}
