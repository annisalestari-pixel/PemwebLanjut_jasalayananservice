// backend/server.js
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const JWT_SECRET = 'karya_mandiri_secret_key_2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Database connection - Disesuaikan untuk HeidiSQL (port 3306)
const db = mysql.createConnection({
    host: 'localhost',     // atau '127.0.0.1'
    port: 3306,            // Port default HeidiSQL/MySQL
    user: 'root',          // Sesuaikan dengan user HeidiSQL Anda
    password: '',          // Sesuaikan dengan password HeidiSQL Anda (biasanya kosong untuk root)
    database: 'karya_mandiri'
});

// Test koneksi database
db.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        console.error('Pastikan:');
        console.error('1. MySQL server sedang berjalan');
        console.error('2. Database "karya_mandiri" sudah dibuat');
        console.error('3. User dan password sesuai');
        return;
    }
    console.log('✅ Connected to MySQL database (HeidiSQL) on port 3306');
});

// Setup upload folder
const uploadDir = './uploads/contracts';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'contract-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ============ AUTHENTICATION ============
// Register
app.post('/api/register', async (req, res) => {
    const { username, password, email, phone } = req.body;
    
    if (!username || !password || !email) {
        return res.status(400).json({ error: 'Username, password, and email required' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO users (username, password, email, phone, role) VALUES (?, ?, ?, ?, "pelanggan")';
        db.query(query, [username, hashedPassword, email, phone || null], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Registration successful', userId: result.insertId });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = 'SELECT * FROM users WHERE username = ?';
    db.query(query, [username], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = results[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, choice: user.choice_option },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // Log audit
        db.query('INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)', 
            [user.id, 'login', `User logged in at ${new Date().toISOString()}`]);
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                phone: user.phone,
                role: user.role,
                choice_option: user.choice_option
            }
        });
    });
});

// Verify token middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Save user choice (Pilihan A or B)
app.post('/api/save-choice', verifyToken, (req, res) => {
    const { choice } = req.body;
    if (!choice || !['A', 'B'].includes(choice)) {
        return res.status(400).json({ error: 'Choice must be A or B' });
    }
    
    const query = 'UPDATE users SET choice_option = ? WHERE id = ?';
    db.query(query, [choice, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Update token with new choice
        const newToken = jwt.sign(
            { ...req.user, choice: choice },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({ message: 'Choice saved', choice, token: newToken });
    });
});

// ============ CONTRACT MODULE ============
// Get all contracts for a user
app.get('/api/contracts', verifyToken, (req, res) => {
    let query = `
        SELECT c.*, u.username as customer_name 
        FROM contracts c
        JOIN users u ON c.customer_id = u.id
    `;
    const params = [];
    
    if (req.user.role === 'pelanggan') {
        query += ' WHERE c.customer_id = ?';
        params.push(req.user.id);
    }
    
    query += ' ORDER BY c.created_at DESC';
    
    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Get single contract
app.get('/api/contracts/:id', verifyToken, (req, res) => {
    const contractId = req.params.id;
    let query = `
        SELECT c.*, u.username as customer_name, u.email as customer_email
        FROM contracts c
        JOIN users u ON c.customer_id = u.id
        WHERE c.id = ?
    `;
    
    db.query(query, [contractId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'Contract not found' });
        res.json(results[0]);
    });
});

// Create new contract
app.post('/api/contracts', verifyToken, (req, res) => {
    const { service_type, description, amount } = req.body;
    const customer_id = req.user.role === 'pelanggan' ? req.user.id : req.body.customer_id;
    
    if (!service_type || !amount) {
        return res.status(400).json({ error: 'Service type and amount required' });
    }
    
    // Generate contract number: STE-{YEAR}/{MONTH}/{SEQUENCE}
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    db.query('SELECT COUNT(*) as count FROM contracts', (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const sequence = String((result[0].count + 1)).padStart(4, '0');
        const contract_number = `STE-${year}/${month}/${sequence}`;
        
        const query = `INSERT INTO contracts (contract_number, customer_id, service_type, description, amount, status) 
                       VALUES (?, ?, ?, ?, ?, 'pending')`;
        db.query(query, [contract_number, customer_id, service_type, description || '', amount], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            db.query('INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'create_contract', `Created contract ${contract_number}`]);
            
            res.json({ message: 'Contract created', contractId: result.insertId, contract_number });
        });
    });
});

// Update contract
app.put('/api/contracts/:id', verifyToken, (req, res) => {
    const contractId = req.params.id;
    const { service_type, description, amount, status } = req.body;
    
    let query = 'UPDATE contracts SET ';
    const updates = [];
    const params = [];
    
    if (service_type) { updates.push('service_type = ?'); params.push(service_type); }
    if (description) { updates.push('description = ?'); params.push(description); }
    if (amount) { updates.push('amount = ?'); params.push(amount); }
    if (status) { updates.push('status = ?'); params.push(status); }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }
    
    query += updates.join(', ');
    query += ' WHERE id = ?';
    params.push(contractId);
    
    db.query(query, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Contract not found' });
        
        res.json({ message: 'Contract updated successfully' });
    });
});

// Sign contract (digital signature simulation)
app.post('/api/contracts/:id/sign', verifyToken, (req, res) => {
    const contractId = req.params.id;
    
    // Check if contract belongs to user
    const checkQuery = 'SELECT * FROM contracts WHERE id = ? AND customer_id = ?';
    db.query(checkQuery, [contractId, req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(403).json({ error: 'Not authorized to sign this contract' });
        if (results[0].status !== 'pending') return res.status(400).json({ error: 'Contract cannot be signed' });
        
        // Generate simulated signature hash
        const crypto = require('crypto');
        const signature_hash = crypto.createHash('sha256')
            .update(`${contractId}-${req.user.id}-${Date.now()}`)
            .digest('hex');
        
        db.query('UPDATE contracts SET status = "signed", signed_at = NOW() WHERE id = ?', 
            [contractId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            
            db.query('INSERT INTO e_signatures (contract_id, signer_id, signature_hash) VALUES (?, ?, ?)',
                [contractId, req.user.id, signature_hash]);
            
            db.query('INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'sign_contract', `Signed contract ID: ${contractId}`]);
            
            res.json({ message: 'Contract signed successfully', signature_hash });
        });
    });
});

// Delete contract
app.delete('/api/contracts/:id', verifyToken, (req, res) => {
    const contractId = req.params.id;
    
    const query = 'DELETE FROM contracts WHERE id = ? AND customer_id = ?';
    db.query(query, [contractId, req.user.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Contract not found' });
        
        res.json({ message: 'Contract deleted successfully' });
    });
});

// ============ POS MODULE ============
// Get all products
app.get('/api/products', verifyToken, (req, res) => {
    db.query('SELECT * FROM products ORDER BY category, name', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Get single product
app.get('/api/products/:id', verifyToken, (req, res) => {
    const productId = req.params.id;
    db.query('SELECT * FROM products WHERE id = ?', [productId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'Product not found' });
        res.json(results[0]);
    });
});

// Create product (admin only)
app.post('/api/products', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { name, category, price, stock } = req.body;
    if (!name || !price) {
        return res.status(400).json({ error: 'Name and price required' });
    }
    
    const query = 'INSERT INTO products (name, category, price, stock) VALUES (?, ?, ?, ?)';
    db.query(query, [name, category || 'jasa', price, stock || 0], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Product created', productId: result.insertId });
    });
});

// Create transaction
app.post('/api/transactions', verifyToken, (req, res) => {
    const { items, payment_method, total_amount } = req.body;
    const customer_id = req.user.role === 'pelanggan' ? req.user.id : (req.body.customer_id || 1);
    
    if (!items || !items.length === 0) {
        return res.status(400).json({ error: 'No items in transaction' });
    }
    
    // Generate transaction number
    const now = new Date();
    const transaction_number = `TRX-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-6)}`;
    
    db.beginTransaction((err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const transactionQuery = `INSERT INTO transactions (transaction_number, customer_id, total_amount, payment_method, status) 
                                   VALUES (?, ?, ?, ?, 'completed')`;
        db.query(transactionQuery, [transaction_number, customer_id, total_amount, payment_method], (err, result) => {
            if (err) {
                return db.rollback(() => res.status(500).json({ error: err.message }));
            }
            
            const transactionId = result.insertId;
            let itemsProcessed = 0;
            let hasError = false;
            
            items.forEach((item) => {
                const itemQuery = `INSERT INTO transaction_items (transaction_id, product_id, quantity, price) 
                                    VALUES (?, ?, ?, ?)`;
                db.query(itemQuery, [transactionId, item.product_id, item.quantity, item.price], (err) => {
                    if (err) {
                        hasError = true;
                        return db.rollback(() => res.status(500).json({ error: err.message }));
                    }
                    
                    // Update stock
                    db.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
                    
                    itemsProcessed++;
                    if (itemsProcessed === items.length && !hasError) {
                        db.commit((err) => {
                            if (err) return db.rollback(() => res.status(500).json({ error: err.message }));
                            
                            db.query('INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
                                [req.user.id, 'create_transaction', `Created transaction ${transaction_number}`]);
                            
                            res.json({ message: 'Transaction completed', transactionId, transaction_number });
                        });
                    }
                });
            });
        });
    });
});

// Get user transactions
app.get('/api/transactions', verifyToken, (req, res) => {
    let query = `
        SELECT t.*, 
               GROUP_CONCAT(CONCAT(p.name, ' (', ti.quantity, 'x)') SEPARATOR ', ') as items,
               COUNT(ti.id) as item_count
        FROM transactions t
        LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
        LEFT JOIN products p ON ti.product_id = p.id
    `;
    const params = [];
    
    if (req.user.role === 'pelanggan') {
        query += ' WHERE t.customer_id = ?';
        params.push(req.user.id);
    }
    
    query += ' GROUP BY t.id ORDER BY t.created_at DESC';
    
    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Get single transaction
app.get('/api/transactions/:id', verifyToken, (req, res) => {
    const transactionId = req.params.id;
    
    const query = `
        SELECT t.*, u.username as customer_name
        FROM transactions t
        JOIN users u ON t.customer_id = u.id
        WHERE t.id = ?
    `;
    
    db.query(query, [transactionId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'Transaction not found' });
        
        // Get transaction items
        const itemsQuery = `
            SELECT ti.*, p.name 
            FROM transaction_items ti
            JOIN products p ON ti.product_id = p.id
            WHERE ti.transaction_id = ?
        `;
        
        db.query(itemsQuery, [transactionId], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ...results[0], items });
        });
    });
});

// ============ DASHBOARD STATS ============
app.get('/api/dashboard-stats', verifyToken, (req, res) => {
    const contractQuery = 'SELECT COUNT(*) as count FROM contracts' + (req.user.role === 'pelanggan' ? ' WHERE customer_id = ?' : '');
    const transactionQuery = 'SELECT COUNT(*) as count FROM transactions' + (req.user.role === 'pelanggan' ? ' WHERE customer_id = ?' : '');
    const revenueQuery = 'SELECT SUM(total_amount) as total FROM transactions WHERE status = "completed"' + (req.user.role === 'pelanggan' ? ' AND customer_id = ?' : '');
    const pendingContractsQuery = 'SELECT COUNT(*) as count FROM contracts WHERE status = "pending"' + (req.user.role === 'pelanggan' ? ' AND customer_id = ?' : '');
    
    const params = req.user.role === 'pelanggan' ? [req.user.id] : [];
    
    Promise.all([
        new Promise((resolve) => db.query(contractQuery, params, (err, result) => resolve(result?.[0]?.count || 0))),
        new Promise((resolve) => db.query(transactionQuery, params, (err, result) => resolve(result?.[0]?.count || 0))),
        new Promise((resolve) => db.query(revenueQuery, params, (err, result) => resolve(result?.[0]?.total || 0))),
        new Promise((resolve) => db.query(pendingContractsQuery, params, (err, result) => resolve(result?.[0]?.count || 0)))
    ]).then(([contractCount, transactionCount, totalRevenue, pendingContracts]) => {
        res.json({ contractCount, transactionCount, totalRevenue, pendingContracts });
    });
});

// ============ AUDIT LOGS ============
app.get('/api/audit-logs', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const query = `
        SELECT al.*, u.username 
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT 100
    `;
    
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ============ USER PROFILE ============
app.get('/api/profile', verifyToken, (req, res) => {
    const query = 'SELECT id, username, email, phone, role, choice_option, created_at FROM users WHERE id = ?';
    db.query(query, [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(results[0]);
    });
});

app.put('/api/profile', verifyToken, (req, res) => {
    const { email, phone } = req.body;
    const query = 'UPDATE users SET email = ?, phone = ? WHERE id = ?';
    db.query(query, [email, phone, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Profile updated successfully' });
    });
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
    db.query('SELECT 1', (err) => {
        if (err) {
            return res.status(500).json({ status: 'error', message: 'Database connection failed' });
        }
        res.json({ status: 'ok', message: 'Server is running', timestamp: new Date().toISOString() });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 API endpoints:`);
    console.log(`   POST   /api/register   - Register new user`);
    console.log(`   POST   /api/login      - Login user`);
    console.log(`   GET    /api/contracts  - Get contracts`);
    console.log(`   POST   /api/contracts  - Create contract`);
    console.log(`   GET    /api/products   - Get products`);
    console.log(`   POST   /api/transactions - Create transaction`);
    console.log(`   GET    /api/dashboard-stats - Get stats`);
    console.log(`   GET    /api/health     - Health check\n`);
});