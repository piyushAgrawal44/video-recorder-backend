import { Server, Socket } from "socket.io";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";


interface RecordingState {
    chunks: Buffer[];
    filename: string;
    startTime: number;
    chunkCount: number;
    initialHeader: Buffer | null;
}

export default function registerSocketHandlers(
    io: Server,
    liveStreams: Record<string, { socketId: string; startedAt: number }>
) {

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SEC
    });
    const recordings: Record<string, RecordingState> = {};

    io.on("connection", (socket: Socket) => {
        console.log(`✅ Connected: ${socket.id}`);

        liveStreams[socket.id] = {
            socketId: socket.id,
            startedAt: Date.now()
        };

        socket.join(socket.id);

        socket.on("recording-start", () => {
            const timestamp = Date.now();
            const filename = `recording_${socket.id}_${timestamp}.webm`;

            recordings[socket.id] = {
                chunks: [],
                filename,
                startTime: timestamp,
                chunkCount: 0,
                initialHeader: null
            };

            console.log(`▶️ Started recording for ${socket.id}`);
        });

        socket.on("video-chunk", (chunk: Buffer, isInitial: boolean) => {
            const recording = recordings[socket.id];
            if (!recording) {
                console.log(`❌ No recording state for ${socket.id}, ignoring chunk.`);
                return;
            }

            // Validate chunk
            if (!chunk || chunk.byteLength === 0) {
                console.log(`❌ Invalid chunk received for ${socket.id}`);
                return;
            }

            const buffer = Buffer.from(chunk);

            if (isInitial && !recording.initialHeader) {
                recording.initialHeader = buffer;
                console.log(`✅ Received initial header for ${socket.id}. Size: ${buffer.byteLength}`);
            } else if (!isInitial) { // Only add non-initial chunks
                recording.chunks.push(buffer);
                console.log(`➡️ Received media chunk for ${socket.id}. Size: ${buffer.byteLength}. Total chunks: ${recording.chunks.length}`);
            }

            recording.chunkCount++;

            // Build complete buffer AFTER adding the new chunk
            let buffers: Buffer[] = [];
            if (recording.initialHeader) {
                buffers.push(recording.initialHeader);
            }
            buffers = buffers.concat(recording.chunks);
            const videoBuffer = Buffer.concat(buffers);
            const completeBuffer = videoBuffer.buffer.slice(videoBuffer.byteOffset, videoBuffer.byteOffset + videoBuffer.byteLength);

            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

            io.to(socket.id).emit("live-stream-video-chunk", {
                currentChunk: arrayBuffer,
                completeChunk: completeBuffer
            });
        });

        socket.on("recording-stopped", () => {
            const recording = recordings[socket.id];
            if (!recording) return;

            console.log("recording-stopped saving the file to cloudinary. It will take 1 moment")
            let buffers: Buffer[] = [];
            if (recording.initialHeader) {
                buffers.push(recording.initialHeader);
            }
            buffers = buffers.concat(recording.chunks);
            const videoBuffer = Buffer.concat(buffers);

            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: "video",
                    folder: "live_recordings"
                },
                (error, result) => {
                    if (error) {
                        console.error("❌ cloudinary upload error:", error);
                        socket.emit("cloudinary-failed", "Failed to save the file on cloudinary");

                        return;
                    }
                    console.log(`✅ Uploaded to Cloudinary: ${result?.secure_url}`);
                    const duration = (Date.now() - recording.startTime) / 1000;

                    socket.emit("recording-saved", {
                        filename: recording.filename,
                        url: result?.secure_url,
                        size: result?.bytes,
                        duration
                    });


                }
            );

            streamifier.createReadStream(videoBuffer).pipe(uploadStream);
            delete recordings[socket.id];
        });

        socket.on("join-room", (streamId) => {
            socket.join(streamId);
        });

        socket.on("stream-chat", ({ streamId, message }) => {
            io.to(streamId).emit("message", { text: "AI: " + message });
        });

        socket.on("disconnect", () => {
            console.log("❌ Disconnected:", socket.id);
            delete liveStreams[socket.id];
            delete recordings[socket.id];
        });
    });
}
