import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();
const OUTPUT_DIR = "uploads";

router.get("/", async (req, res) => {
  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    const webmFiles = files.filter(f => f.endsWith(".webm"));

    const data = await Promise.all(
      webmFiles.map(async (filename) => {
        const stat = await fs.promises.stat(path.join(OUTPUT_DIR, filename));
        const match = filename.match(/_(\d+)\.webm$/);
        const timestamp = match ? parseInt(match[1]) : Date.now();

        return {
          filename,
          size: stat.size,
          timestamp,
          url: `/recordings/${filename}`
        };
      })
    );

    res.json({ recordings: data });
  } catch (err) {
    console.error("Error reading recordings:", err);
    res.status(500).json({ error: "Unable to read recordings" });
  }
});

router.get("/:filename", (req, res):any => {
  const filePath = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Recording not found" });
  }

  res.setHeader("Content-Type", "video/webm");
  res.setHeader("Content-Disposition", `inline; filename="${req.params.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

export default router;
