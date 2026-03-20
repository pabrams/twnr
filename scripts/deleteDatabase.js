import mongoose from 'mongoose';
async function deleteDatabase() {
  try {
    console.log("Connecting to database...");
    await mongoose.connect('mongodb://localhost:27017/twnr');

    console.log("connected");
    await mongoose.connection.db.dropDatabase();
    console.log('Database deleted successfully');
  } catch (error) {
    console.error('Error deleting the database:', error);
  } finally {
    mongoose.connection.close();
  }
}
deleteDatabase();