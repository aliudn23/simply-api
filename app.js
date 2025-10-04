import express, { json } from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
const app = express();

const mongoUri = 'mongodb://localhost:27017/simplydb'; // Change as needed
const client = new MongoClient(mongoUri);

let db;

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db();
        console.log('Connected to MongoDB');
        // You can now use `db` to access collections, e.g. db.collection('tasks')
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
}

connectToMongo();

app.get('/db-status', async (req, res) => {
    try {
        // Ping the database to check connection
        await db.command({ ping: 1 });
        res.json({ success: true, message: 'MongoDB connection is healthy' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'MongoDB connection failed', error: error.message });
    }
});

app.use(cors({
    origin: 'http://simply-task.test:3000', // Replace with your Vue app's origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (req, res) => {
  res.send('Welcome to simply-api test!');
});

// Generate a random bearer token at server start
const serverBearerToken = "hvptSQkJcYA_rj5uKbKZ44w1L9BPBi_4"; // 32 chars, URL-safe

// Middleware to check for Bearer token before /login
app.use('/login', (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    if (token !== serverBearerToken) {
        return res.status(403).json({ error: 'Invalid bearer token' });
    }
    next();
});

// Middleware to parse JSON bodies
app.use(json());

// Login API Endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    // Simple hardcoded user for demo purposes
    const validUser = {
        username: "user@example.com",
        password: "password"
    };

    if (username === validUser.username && password === validUser.password) {
        // Simple token generator (for demo purposes)
        const token = Math.random().toString(36).substr(2) + Date.now().toString(36);
        // Save token to session collection with expiry (e.g., 1 hour from now)
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
        await db.collection('session').insertOne({ token, expired: expiresAt });

        res.status(200).json({
            success: true,
            message: "Login successful",
            token
        });
    } else {
        res.status(401).json({ error: "Invalid username or password" });
    }
});

app.post('/check-token', async (req, res) => {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.body && req.body.token) {
        token = req.body.token;
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }
    if (!token) {
        return res.status(400).json({ success: false, message: "Token is required" });
    }
    try {
        const session = await db.collection('session').findOne({ token });
        if (!session) {
            return res.status(401).json({ success: false, message: "Token not found" });
        }
        if (session.expired && new Date(session.expired) < new Date()) {
            return res.status(401).json({ success: false, message: "Token expired" });
        }
        res.json({ success: true, message: "Token is valid" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});

// Middleware to check token for /tasks routes
async function checkTokenMiddleware(req, res, next) {
    // Token can be sent via Authorization header as Bearer or as a query param or body
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    } else if (req.body && req.body.token) {
        token = req.body.token;
    }
    if (!token) {
        return res.status(401).json({ success: false, message: "Token is required" });
    }
    try {
        const session = await db.collection('session').findOne({ token });
        if (!session) {
            return res.status(401).json({ success: false, message: "Token not found" });
        }
        if (session.expired && new Date(session.expired) < new Date()) {
            return res.status(401).json({ success: false, message: "Token expired" });
        }
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
}

// Apply token check middleware to all /tasks routes
app.use('/tasks', checkTokenMiddleware);

// GET /tasks (with filtering, sorting, pagination)
app.get('/tasks', async (req, res) => {
    try {
        const collection = db.collection('tasks');
        const query = {};

        // Filtering
        if (req.query.status) {
            query.status = req.query.status;
        }
        if (req.query.search) {
            query.title = { $regex: req.query.search, $options: 'i' };
        }

        // Sorting
        let sort = {};
        if (req.query.sortBy) {
            const order = req.query.order === 'desc' ? -1 : 1;
            sort[req.query.sortBy] = order;
        }

        // Pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 0;
        const skip = (page - 1) * limit;

        const total = await collection.countDocuments(query);
        let cursor = collection.find(query);

        if (Object.keys(sort).length > 0) {
            cursor = cursor.sort(sort);
        }
        if (limit > 0) {
            cursor = cursor.skip(skip).limit(limit);
        }

        const tasks = await cursor.toArray();

        res.json({
            meta: {
                success: true,
                message: "Tasks fetched successfully",
                total,
                page,
                limit: limit || total
            },
            tasks
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});

// POST /tasks (add a new task)
app.post('/tasks', async (req, res) => {
    try {
        const { title, description, status } = req.body;
        if (!title || !description || !status) {
            return res.status(400).json({ success: false, message: "Title, description, and status are required" });
        }
        const collection = db.collection('tasks');

        // Find the max id in the collection
        const lastTask = await collection.find().sort({ id: -1 }).limit(1).toArray();
        const nextId = lastTask.length > 0 ? lastTask[0].id + 1 : 1;

        const newTask = { id: nextId, title, description, status };
        // MongoDB will automatically generate an _id field of type ObjectId
        const result = await collection.insertOne(newTask);
        newTask._id = result.insertedId; // This is the auto-generated id
        res.status(201).json({
            success: true,
            message: "Task added successfully",
            task: newTask
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});

// PUT /tasks/:id (edit a task)
app.put('/tasks/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, message: "Invalid task id" });
        }
        const { title, description, status } = req.body;

        // Only update provided fields
        const updateFields = {};
        if (title !== undefined) updateFields.title = title;
        if (description !== undefined) updateFields.description = description;
        if (status !== undefined) updateFields.status = status;

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ success: false, message: "No fields to update" });
        }

        const collection = db.collection('tasks');
        // Ensure atomic operator is used
        const result = await collection.findOneAndUpdate(
            { id: id }, // Find by the custom 'id' field, not MongoDB's '_id'
            { $set: updateFields }, 
            { returnDocument: 'after' }
        );

        

        if (!result.task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        res.json({
            success: true,
            message: "Task updated successfully",
            task: result.task
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});

// DELETE /tasks/:id (delete a task)
app.delete('/tasks/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, message: "Invalid task id" });
        }
        const collection = db.collection('tasks');
        const result = await collection.deleteOne({ id: id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }
        res.json({
            success: true,
            message: "Task deleted successfully"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});

module.exports = app;