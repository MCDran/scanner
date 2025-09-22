const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

// MySQL connection setup with environment variables and retry logic
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'mysql',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'haunt_user',
    password: process.env.DB_PASSWORD || 'your_secure_password_here',
    database: process.env.DB_NAME || 'haunted_house',
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    charset: 'utf8mb4'
});

// Service health monitoring
let isHealthy = false;
let connectionAttempts = 0;
const maxRetries = 10;

function attemptDatabaseConnection() {
    connectionAttempts++;
    console.log(`Database connection attempt ${connectionAttempts}/${maxRetries}...`);
    
    pool.getConnection((err, connection) => {
        if (err) {
            console.error(`Error connecting to SQL pool (attempt ${connectionAttempts}):`, err.message);
            isHealthy = false;
            
            if (connectionAttempts < maxRetries) {
                console.log(`Retrying in 5 seconds...`);
                setTimeout(attemptDatabaseConnection, 5000);
            } else {
                console.error('Max database connection attempts reached. Service will run without database.');
            }
            return;
        }
        
        console.log('✅ Scanner service connected to database successfully!');
        isHealthy = true;
        connection.release();
        
        // Register service health
        registerServiceHealth();
        
        // Set up heartbeat
        setInterval(updateHeartbeat, 30000); // Update every 30 seconds
    });
}

// Start connection attempts
attemptDatabaseConnection();

function registerServiceHealth() {
    const sql = `INSERT INTO service_health (service_name, status, last_heartbeat) 
                 VALUES ('scanner', 'ONLINE', NOW()) 
                 ON DUPLICATE KEY UPDATE status = 'ONLINE', last_heartbeat = NOW()`;
    pool.query(sql, (err) => {
        if (err) console.error('Error registering service health:', err);
    });
}

function updateHeartbeat() {
    if (isHealthy) {
        const sql = `UPDATE service_health SET last_heartbeat = NOW(), status = 'ONLINE' 
                     WHERE service_name = 'scanner'`;
        pool.query(sql, (err) => {
            if (err) console.error('Error updating heartbeat:', err);
        });
    }
}

function logSystemEvent(eventType, registrationNumber = null, eventData = null) {
    const eventId = `scanner_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sql = `INSERT INTO system_events (event_id, event_type, source_service, registration_number, event_data) 
                 VALUES (?, ?, 'scanner', ?, ?)`;
    pool.query(sql, [eventId, eventType, registrationNumber, JSON.stringify(eventData)], (err) => {
        if (err) console.error('Error logging system event:', err);
    });
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.json());

// Security headers for camera access
app.use((req, res, next) => {
    // Enable camera access for HTTPS and localhost
    res.setHeader('Permissions-Policy', 'camera=self');
    // Allow camera access in iframes if needed
    res.setHeader('Feature-Policy', 'camera \'self\'');
    // Ensure secure context for camera access
    if (req.headers['x-forwarded-proto'] === 'http' && !req.hostname.includes('localhost')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        service: 'scanner',
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: isHealthy ? 'connected' : 'disconnected'
    });
});

// Serve the QR code scanner page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// API route to handle QR code scan data
app.post('/checkin', (req, res) => {
    const { registrationNumber, email } = req.body;

    if (!isHealthy) {
        console.log(`Check-in attempt while database offline: ${registrationNumber}`);
        return res.status(503).json({
            success: false,
            message: 'Database service unavailable. Please try again in a moment.'
        });
    }

    // Query to verify registration from MySQL
    const sql = 'SELECT * FROM registrations WHERE registration_number = ? AND email = ?';
    pool.query(sql, [registrationNumber, email], (err, results) => {
        if (err) {
            console.error('Database error during check-in:', err);
            logSystemEvent('SYSTEM_ERROR', registrationNumber, { error: err.message, endpoint: 'checkin' });
            return res.status(500).json({
                success: false,
                message: 'Database error occurred'
            });
        }

        if (results.length === 0) {
            console.log(`Check-in attempt failed: Registration ${registrationNumber} not found`);
            logSystemEvent('CHECKIN_FAILED', registrationNumber, { 
                reason: 'registration_not_found',
                email: email 
            });
            return res.status(404).json({
                success: false,
                message: 'Registrant not found!'
            });
        }

        const registrant = results[0];
        
        // Check if already checked in
        if (registrant.checked_in) {
            console.log(`Registration ${registrationNumber} already checked in`);
            return res.status(200).json({
                success: true,
                alreadyCheckedIn: true,
                registrant: {
                    name: registrant.names,
                    timeSlot: registrant.time_slot,
                    checkedInAt: registrant.checked_in_at
                }
            });
        }

        // Update check-in status
        const updateSql = 'UPDATE registrations SET checked_in = TRUE, checked_in_at = NOW(), checked_in_by = ? WHERE registration_number = ?';
        pool.query(updateSql, ['scanner_system', registrationNumber], (updateErr) => {
            if (updateErr) {
                console.error('Error updating check-in status:', updateErr);
                logSystemEvent('SYSTEM_ERROR', registrationNumber, { error: updateErr.message, endpoint: 'checkin_update' });
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update check-in status'
                });
            }

            console.log(`Successfully checked in registration ${registrationNumber}`);
            
            // Log successful check-in event
            logSystemEvent('GUEST_ARRIVAL', registrationNumber, {
                name: registrant.names,
                timeSlot: registrant.time_slot,
                email: registrant.email,
                checkedInAt: new Date().toISOString()
            });

            // Respond with registrant details
            res.status(200).json({
                success: true,
                registrant: {
                    name: registrant.names,
                    timeSlot: registrant.time_slot,
                    guestCount: registrant.names.split(',').length,
                    specialRequests: registrant.special_requests
                }
            });
        });
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🎃 QR Code Scanner server running on port ${PORT}`);
});