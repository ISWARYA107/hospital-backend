const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const db = mysql.createConnection({
    host: 'metro.proxy.rlwy.net',      // or 'localhost'
    user: 'root',           // Your MySQL Workbench username
    password: 'dqrcnjfGOIYxLrHAgLcVIsjatZOPkFqJ',  // ⚠️ IMPORTANT: Put your MySQL password
    database: 'railway',
    port: 48453              // Default MySQL port
});
db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
    } else {
        console.log('✅ Connected to MySQL database');
    }
});

// ============================================
// AUTHENTICATION APIs
// ============================================

// Login API
app.post('/api/login', (req, res) => {
    const { email, password, role } = req.body;
    
    const query = 'SELECT * FROM users WHERE email = ? AND password = ? AND role = ?';
    db.query(query, [email, password, role], (err, results) => {
        if (err) {
            res.status(500).json({ success: false, message: 'Database error' });
        } else if (results.length > 0) {
            res.json({ 
                success: true, 
                user: results[0],
                message: 'Login successful'
            });
        } else {
            res.json({ success: false, message: 'Invalid email or password' });
        }
    });
});

// Register Patient
app.post('/api/register', async (req, res) => {
    const { name, email, password, phone, dob, gender, address, blood_group } = req.body;
    
    // Check if email exists
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (results.length > 0) {
            return res.json({ success: false, message: 'Email already exists' });
        }
        
        // Insert into users table
        db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, "patient")', 
            [name, email, password], (err, result) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Registration failed' });
            }
            
            const userId = result.insertId;
            
            // Insert into patients table
            db.query('INSERT INTO patients (user_id, phone, dob, gender, address, blood_group) VALUES (?, ?, ?, ?, ?, ?)', 
                [userId, phone, dob || null, gender || null, address || null, blood_group || null], (err) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Failed to save patient details' });
                }
                res.json({ success: true, message: 'Registration successful! Please login.' });
            });
        });
    });
});

// ============================================
// PATIENT APIs
// ============================================

// Get patient ID from user ID
app.get('/api/patient-id/:userId', (req, res) => {
    db.query('SELECT id FROM patients WHERE user_id = ?', [req.params.userId], (err, results) => {
        if (err) {
            res.status(500).json({ error: err });
        } else {
            res.json({ patientId: results[0]?.id });
        }
    });
});

// Get all doctors
app.get('/api/doctors', (req, res) => {
    const query = `
        SELECT d.id, u.name, d.specialization, d.phone, d.available_from, d.available_to 
        FROM doctors d 
        JOIN users u ON d.user_id = u.id
    `;
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get available slots for a doctor on a specific date
app.get('/api/available-slots/:doctorId/:date', (req, res) => {
    const { doctorId, date } = req.params;
    
    // Generate time slots from 9 AM to 5 PM
    const allSlots = [];
    for (let hour = 9; hour <= 17; hour++) {
        const time = `${hour.toString().padStart(2, '0')}:00`;
        if (hour !== 13) { // Skip 1 PM (lunch break)
            allSlots.push(time);
        }
    }
    
    // Get booked slots
    const bookedQuery = 'SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != "cancelled"';
    db.query(bookedQuery, [doctorId, date], (err, bookedSlots) => {
        if (err) {
            res.status(500).json([]);
            return;
        }
        
        const bookedTimes = bookedSlots.map(slot => slot.appointment_time.substring(0, 5));
        const availableSlots = allSlots.filter(slot => !bookedTimes.includes(slot));
        res.json(availableSlots);
    });
});

// Book appointment
app.post('/api/appointments', (req, res) => {
    const { patientId, doctorId, date, time, notes } = req.body;
    
    const query = 'INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status, notes) VALUES (?, ?, ?, ?, "pending", ?)';
    db.query(query, [patientId, doctorId, date, time, notes || null], (err, result) => {
        if (err) {
            res.status(500).json({ success: false, message: 'Slot already booked or invalid data' });
        } else {
            res.json({ success: true, appointmentId: result.insertId });
        }
    });
});

// Get patient's appointments
app.get('/api/my-appointments/:patientId', (req, res) => {
    const { patientId } = req.params;
    
    const query = `
        SELECT a.*, u.name as doctor_name, d.specialization
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u ON d.user_id = u.id
        WHERE a.patient_id = ?
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `;
    db.query(query, [patientId], (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Cancel appointment
app.put('/api/cancel-appointment/:appointmentId', (req, res) => {
    const { appointmentId } = req.params;
    
    const query = 'UPDATE appointments SET status = "cancelled" WHERE id = ?';
    db.query(query, [appointmentId], (err) => {
        if (err) {
            res.status(500).json({ success: false });
        } else {
            res.json({ success: true });
        }
    });
});

// ============================================
// DOCTOR APIs
// ============================================

// Get doctor ID from user ID
app.get('/api/doctor-id/:userId', (req, res) => {
    db.query('SELECT id FROM doctors WHERE user_id = ?', [req.params.userId], (err, results) => {
        if (err) {
            res.status(500).json({ error: err });
        } else {
            res.json({ doctorId: results[0]?.id });
        }
    });
});

// Get doctor's pending appointments
app.get('/api/doctor-appointments/:doctorId', (req, res) => {
    const { doctorId } = req.params;
    
    const query = `
        SELECT a.*, u.name as patient_name, p.phone, p.dob, p.gender, p.blood_group
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON p.user_id = u.id
        WHERE a.doctor_id = ? AND a.status = "pending"
        ORDER BY a.appointment_date, a.appointment_time
    `;
    db.query(query, [doctorId], (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get doctor's completed appointments
app.get('/api/doctor-completed-appointments/:doctorId', (req, res) => {
    const { doctorId } = req.params;
    
    const query = `
        SELECT a.*, u.name as patient_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON p.user_id = u.id
        WHERE a.doctor_id = ? AND a.status = "completed"
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT 20
    `;
    db.query(query, [doctorId], (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get all available rooms
app.get('/api/rooms', (req, res) => {
    const query = 'SELECT * FROM rooms WHERE status = "available"';
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get all rooms (for admin)
app.get('/api/all-rooms', (req, res) => {
    const query = 'SELECT * FROM rooms ORDER BY room_number';
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Doctor decision - OP or IP
app.post('/api/doctor-decision', (req, res) => {
    const { appointmentId, decision, diagnosis, prescription, followUpDate, roomId, treatment } = req.body;
    
    // First update appointment status to completed
    const updateAppointment = 'UPDATE appointments SET status = "completed", notes = ? WHERE id = ?';
    db.query(updateAppointment, [diagnosis || null, appointmentId], (err) => {
        if (err) {
            res.status(500).json({ success: false, message: 'Failed to update appointment' });
            return;
        }
        
        if (decision === 'OP') {
            // Outpatient - add to outpatients table
            const opQuery = 'INSERT INTO outpatients (appointment_id, diagnosis, prescription, follow_up_date) VALUES (?, ?, ?, ?)';
            db.query(opQuery, [appointmentId, diagnosis, prescription, followUpDate || null], (err) => {
                if (err) {
                    res.status(500).json({ success: false, message: 'Failed to save OP record' });
                } else {
                    res.json({ success: true, message: 'Patient treated as Out-Patient (OP)' });
                }
            });
        } else {
            // Inpatient - admit to room
            // Check if room is available
            db.query('SELECT status FROM rooms WHERE id = ?', [roomId], (err, rooms) => {
                if (err || rooms.length === 0 || rooms[0].status !== 'available') {
                    res.status(500).json({ success: false, message: 'Room not available' });
                    return;
                }
                
                // Update room status to occupied
                db.query('UPDATE rooms SET status = "occupied" WHERE id = ?', [roomId]);
                
                // Admit patient
                const ipQuery = 'INSERT INTO inpatients (appointment_id, room_id, admission_date, diagnosis, treatment) VALUES (?, ?, CURDATE(), ?, ?)';
                db.query(ipQuery, [appointmentId, roomId, diagnosis, treatment], (err) => {
                    if (err) {
                        res.status(500).json({ success: false, message: 'Failed to admit patient' });
                    } else {
                        res.json({ success: true, message: 'Patient admitted as In-Patient (IP)' });
                    }
                });
            });
        }
    });
});

// Get admitted patients (IP)
app.get('/api/admitted-patients', (req, res) => {
    const query = `
        SELECT ip.*, u.name as patient_name, r.room_number, r.room_type
        FROM inpatients ip
        JOIN appointments a ON ip.appointment_id = a.id
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON p.user_id = u.id
        JOIN rooms r ON ip.room_id = r.id
        WHERE ip.discharge_date IS NULL AND ip.status = "admitted"
        ORDER BY ip.admission_date DESC
    `;
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Discharge patient
app.put('/api/discharge/:inpatientId', (req, res) => {
    const { inpatientId } = req.params;
    const { dischargeNotes } = req.body;
    
    // Get room_id first
    db.query('SELECT room_id FROM inpatients WHERE id = ?', [inpatientId], (err, result) => {
        if (err || result.length === 0) {
            return res.status(500).json({ success: false });
        }
        
        const roomId = result[0].room_id;
        
        // Update discharge date and status
        const dischargeQuery = 'UPDATE inpatients SET discharge_date = CURDATE(), status = "discharged" WHERE id = ?';
        db.query(dischargeQuery, [inpatientId], (err) => {
            if (err) {
                return res.status(500).json({ success: false });
            }
            
            // Free the room
            db.query('UPDATE rooms SET status = "available" WHERE id = ?', [roomId]);
            
            res.json({ success: true, message: 'Patient discharged successfully' });
        });
    });
});

// ============================================
// ADMIN APIs
// ============================================

// Create doctor (admin only)
app.post('/api/register-doctor', async (req, res) => {
    const { name, email, password, specialization, phone } = req.body;
    
    // Check if email exists
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (results.length > 0) {
            return res.json({ success: false, message: 'Email already exists' });
        }
        
        // Insert into users table
        db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, "doctor")', 
            [name, email, password], (err, result) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Failed to create doctor' });
            }
            
            const userId = result.insertId;
            
            // Insert into doctors table
            db.query('INSERT INTO doctors (user_id, specialization, phone) VALUES (?, ?, ?)', 
                [userId, specialization, phone || null], (err) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Failed to save doctor details' });
                }
                res.json({ success: true, message: 'Doctor created successfully!' });
            });
        });
    });
});

// Get all doctors (for admin)
app.get('/api/all-doctors', (req, res) => {
    const query = `
        SELECT d.*, u.name, u.email, u.created_at
        FROM doctors d
        JOIN users u ON d.user_id = u.id
        ORDER BY u.created_at DESC
    `;
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get all patients (for admin)
app.get('/api/all-patients', (req, res) => {
    const query = `
        SELECT p.*, u.name, u.email, u.created_at
        FROM patients p
        JOIN users u ON p.user_id = u.id
        ORDER BY u.created_at DESC
    `;
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get all appointments (for admin)
app.get('/api/all-appointments', (req, res) => {
    const query = `
        SELECT a.*, 
               u1.name as patient_name, 
               u2.name as doctor_name,
               d.specialization
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u1 ON p.user_id = u1.id
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u2 ON d.user_id = u2.id
        ORDER BY a.created_at DESC
        LIMIT 50
    `;
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json([]);
        } else {
            res.json(results);
        }
    });
});

// Get dashboard statistics (for admin)
app.get('/api/admin-stats', (req, res) => {
    const queries = {
        totalDoctors: 'SELECT COUNT(*) as count FROM doctors',
        totalPatients: 'SELECT COUNT(*) as count FROM patients',
        totalAppointments: 'SELECT COUNT(*) as count FROM appointments',
        pendingAppointments: 'SELECT COUNT(*) as count FROM appointments WHERE status = "pending"',
        admittedPatients: 'SELECT COUNT(*) as count FROM inpatients WHERE discharge_date IS NULL',
        availableRooms: 'SELECT COUNT(*) as count FROM rooms WHERE status = "available"'
    };
    
    const results = {};
    let completed = 0;
    const total = Object.keys(queries).length;
    
    for (const [key, query] of Object.entries(queries)) {
        db.query(query, (err, result) => {
            if (err) {
                results[key] = 0;
            } else {
                results[key] = result[0].count;
            }
            completed++;
            if (completed === total) {
                res.json(results);
            }
        });
    }
});



app.post('/api/doctor-decision', (req, res) => {
  const { appointmentId, decision, diagnosis, prescription, followUpDate, roomId, treatment, doctorId } = req.body;
  
  const updateAppointment = 'UPDATE appointments SET status = "completed", notes = ? WHERE id = ?';
  db.query(updateAppointment, [diagnosis || null, appointmentId], (err) => {
    if (err) {
      res.status(500).json({ success: false });
      return;
    }
    
    if (decision === 'OP') {
      const opQuery = 'INSERT INTO outpatients (appointment_id, diagnosis, prescription, follow_up_date) VALUES (?, ?, ?, ?)';
      db.query(opQuery, [appointmentId, diagnosis, prescription, followUpDate || null], (err) => {
        if (err) {
          res.status(500).json({ success: false });
        } else {
          res.json({ success: true, message: 'Patient treated as Out-Patient (OP)' });
        }
      });
    } else {
      // Check if room is available
      db.query('SELECT status FROM rooms WHERE id = ?', [roomId], (err, rooms) => {
        if (err || rooms.length === 0 || rooms[0].status !== 'available') {
          res.status(500).json({ success: false, message: 'Room not available' });
          return;
        }
        
        // Update room status to occupied
        db.query('UPDATE rooms SET status = "occupied" WHERE id = ?', [roomId]);
        
        // Admit patient with doctor_id
        const ipQuery = `INSERT INTO inpatients (appointment_id, room_id, admission_date, diagnosis, treatment, doctor_id) 
                         VALUES (?, ?, CURDATE(), ?, ?, ?)`;
        db.query(ipQuery, [appointmentId, roomId, diagnosis, treatment, doctorId], (err) => {
          if (err) {
            res.status(500).json({ success: false });
          } else {
            res.json({ success: true, message: 'Patient admitted as In-Patient (IP)' });
          }
        });
      });
    }
  });
});

// Update the get admitted patients endpoint to include doctor info
app.get('/api/admitted-patients/:doctorId', (req, res) => {
  const { doctorId } = req.params;
  
  const query = `
    SELECT ip.*, u.name as patient_name, r.room_number, r.room_type, ip.doctor_id
    FROM inpatients ip
    JOIN appointments a ON ip.appointment_id = a.id
    JOIN patients p ON a.patient_id = p.id
    JOIN users u ON p.user_id = u.id
    JOIN rooms r ON ip.room_id = r.id
    WHERE ip.discharge_date IS NULL AND ip.status = "admitted" AND ip.doctor_id = ?
  `;
  db.query(query, [doctorId], (err, results) => {
    if (err) {
      res.status(500).json([]);
    } else {
      res.json(results);
    }
  });
});

// Update discharge endpoint - verify doctor permission
app.put('/api/discharge/:inpatientId', (req, res) => {
  const { inpatientId } = req.params;
  const { doctorId } = req.body;
  
  // First check if this patient was admitted by this doctor
  db.query('SELECT room_id, doctor_id FROM inpatients WHERE id = ?', [inpatientId], (err, result) => {
    if (err || result.length === 0) {
      return res.status(500).json({ success: false, message: 'Patient not found' });
    }
    
    const roomId = result[0].room_id;
    const admittingDoctorId = result[0].doctor_id;
    
    // Check if the current doctor is the one who admitted
    if (admittingDoctorId !== parseInt(doctorId)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only the doctor who admitted this patient can discharge them' 
      });
    }
    
    // Update discharge date and status
    const dischargeQuery = 'UPDATE inpatients SET discharge_date = CURDATE(), status = "discharged" WHERE id = ?';
    db.query(dischargeQuery, [inpatientId], (err) => {
      if (err) {
        return res.status(500).json({ success: false });
      }
      
      // Free the room
      db.query('UPDATE rooms SET status = "available" WHERE id = ?', [roomId]);
      
      res.json({ success: true, message: 'Patient discharged successfully' });
    });
  });
});



// Add this after your existing routes
app.post('/api/create-initial-doctor', (req, res) => {
    // Check if doctor already exists
    db.query('SELECT * FROM users WHERE email = "doctor@hospital.com"', (err, results) => {
        if (results.length > 0) {
            return res.json({ success: false, message: 'Doctor already exists' });
        }
        
        // Create doctor user
        db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, "doctor")', 
            ['Dr. Sharma', 'doctor@hospital.com', 'doctor123', 'doctor'], (err, result) => {
            if (err) return res.json({ success: false });
            
            const userId = result.insertId;
            
            // Create doctor profile
            db.query('INSERT INTO doctors (user_id, specialization, phone) VALUES (?, ?, ?)', 
                [userId, 'General Physician', '9876543210'], (err) => {
                if (err) return res.json({ success: false });
                res.json({ success: true, message: 'Doctor created successfully!' });
            });
        });
    });
});




// GET AVAILABLE SLOTS - FIXED
app.get('/api/available-slots/:doctorId/:date', (req, res) => {
  const { doctorId, date } = req.params;
  
  // All possible time slots from 9 AM to 5 PM
  const allSlots = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
  
  // Get booked slots for this doctor on this date
  const query = 'SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != "cancelled"';
  
  db.query(query, [doctorId, date], (err, bookedSlots) => {
    if (err) {
      console.error('Error fetching booked slots:', err);
      return res.status(500).json([]);
    }
    
    // Extract booked times
    const bookedTimes = bookedSlots.map(slot => {
      // Handle time format (could be '09:00:00' or '09:00')
      const timeStr = slot.appointment_time;
      return timeStr.substring(0, 5); // Get HH:MM format
    });
    
    // Filter available slots
    const availableSlots = allSlots.filter(slot => !bookedTimes.includes(slot));
    
    console.log(`Doctor ${doctorId} on ${date}:`, { allSlots, bookedTimes, availableSlots });
    
    res.json(availableSlots);
  });
});





// ============================================
// GET ALL OUTPATIENTS (OP) RECORDS
// ============================================
app.get('/api/outpatients', (req, res) => {
  const query = `
    SELECT op.*, u.name as patient_name, a.appointment_date, a.appointment_time
    FROM outpatients op
    JOIN appointments a ON op.appointment_id = a.id
    JOIN patients p ON a.patient_id = p.id
    JOIN users u ON p.user_id = u.id
    ORDER BY a.appointment_date DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      res.status(500).json([]);
    } else {
      res.json(results);
    }
  });
});

// ============================================
// GET ALL INPATIENTS (IP) RECORDS
// ============================================
app.get('/api/inpatients', (req, res) => {
  const query = `
    SELECT ip.*, u.name as patient_name, r.room_number, r.room_type,
           a.appointment_date, d2.name as doctor_name
    FROM inpatients ip
    JOIN appointments a ON ip.appointment_id = a.id
    JOIN patients p ON a.patient_id = p.id
    JOIN users u ON p.user_id = u.id
    JOIN rooms r ON ip.room_id = r.id
    JOIN doctors d ON ip.doctor_id = d.id
    JOIN users d2 ON d.user_id = d2.id
    ORDER BY ip.admission_date DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      res.status(500).json([]);
    } else {
      res.json(results);
    }
  });
});

// ============================================
// SEARCH PATIENTS
// ============================================
app.get('/api/search-patients/:keyword', (req, res) => {
  const keyword = `%${req.params.keyword}%`;
  const query = `
    SELECT u.id, u.name, u.email, p.phone, p.blood_group,
           (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) as total_visits
    FROM users u
    JOIN patients p ON u.id = p.user_id
    WHERE u.name LIKE ? OR u.email LIKE ? OR p.phone LIKE ?
    LIMIT 50
  `;
  db.query(query, [keyword, keyword, keyword], (err, results) => {
    if (err) {
      res.status(500).json([]);
    } else {
      res.json(results);
    }
  });
});



// Start server
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 API endpoints ready:`);
    console.log(`   POST /api/login`);
    console.log(`   POST /api/register`);
    console.log(`   GET  /api/doctors`);
    console.log(`   GET  /api/rooms`);
    console.log(`   and more...`);
});