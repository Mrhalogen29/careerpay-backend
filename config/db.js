import mongoose from "mongoose";

// Function to connect to the MongoDB database

const connectDB = async () => {
  try {
    mongoose.connection.on("connected", () => 
      console.log("Database Connected")
    );
    
    mongoose.connection.on("error", (err) => 
      console.error("Database connection error:", err)
    );
    
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;