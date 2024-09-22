const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

// MySQL connection setup
const connection = mysql.createConnection({
    host: '100.87.150.78',
    port: '3667',
    user: 'valak',
    password: 'SLEEP4tG',
    database: 'MYSQL_DATABASE'
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err.stack);
        return;
    }
    console.log('Connected to MySQL');
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.json());

// Serve the QR code scanner page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// API route to handle QR code scan data
app.post('/checkin', (req, res) => {
    const { registrationNumber, email } = req.body;

    // Query to verify registration from MySQL
    const sql = 'SELECT * FROM registrations WHERE registration_number = ? AND email = ?';
    connection.query(sql, [registrationNumber, email], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registrant not found!'
            });
        }

        // Respond with registrant details if found
        const registrant = results[0];
        res.status(200).json({
            success: true,
            registrant: {
                name: registrant.names,
                timeSlot: registrant.time_slot
            }
        });
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`QR Code Scanner server running on port ${PORT}`);
});
