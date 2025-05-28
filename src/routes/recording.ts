import express from "express";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();



// GET /recordings – List all videos in Cloudinary folder
router.get("/", async (req, res) => {
  try {
    // Cloudinary configuration
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SEC,
    });
    const result = await cloudinary.search
      .expression("resource_type:video AND folder:live_recordings")
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const recordings = result.resources.map((video: any) => {
      const timestamp = new Date(video.created_at).getTime();

      return {
        filename: video.public_id.split("/").pop() + ".webm", // simulate old naming
        size: video.bytes,
        duration: video.duration,
        timestamp,
        url: video.secure_url
      };
    });

    res.json({ recordings });
  } catch (err) {
    console.error("Error fetching recordings from Cloudinary:", err);
    res.status(500).json({ error: "Unable to fetch recordings" });
  }
});

// GET /recordings/:filename – Redirect to Cloudinary file
router.get("/:filename", async (req, res): Promise<any> => {
  const publicId = `live_recordings/${req.params.filename.replace(/\.webm$/, "")}`;

  try {
    const result = await cloudinary.api.resource(publicId, { resource_type: "video" });
    return res.redirect(result.secure_url);
  } catch (err) {
    console.error("Error fetching video:", err);
    return res.status(404).json({ error: "Recording not found" });
  }
});

export default router;
