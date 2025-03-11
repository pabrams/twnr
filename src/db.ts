import mongoose from "mongoose";

// ✅ Define Schema
const WarpSchema = new mongoose.Schema({
  nodeNumber: { type: Number, required: true, unique: true },
  warps: [{ type: Number, required: true }],
});

// ✅ Define Model
const SectorWarps = mongoose.model("SectorWarps", WarpSchema);

// ✅ Database Connection Logic
const MONGO_URI = "mongodb://localhost:27017/twnr"; // Update with your DB name

let isConnected = false; // Track connection state

export const connectDB = async (): Promise<void> => {
  if (isConnected) return; // Prevent duplicate connections

  try {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// ✅ Export model and connection function
export { SectorWarps };
