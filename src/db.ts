import mongoose from "mongoose";

const WarpSchema = new mongoose.Schema({
  nodeNumber: { type: Number, required: true, unique: true },
  warps: [{ type: Number, required: true }],
});

const SectorWarps = mongoose.model("SectorWarps", WarpSchema);

const MONGO_URI = "mongodb://localhost:27017/twnr"; // Update with your DB name

let isConnected = false;

export const connectDB = async (): Promise<void> => {
  if (isConnected) return;

  try {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

export { SectorWarps };
