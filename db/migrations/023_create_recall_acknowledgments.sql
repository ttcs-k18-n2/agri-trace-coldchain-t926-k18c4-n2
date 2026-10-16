CREATE TABLE IF NOT EXISTS recall_acknowledgments (
    id SERIAL PRIMARY KEY,
    recall_id INT NOT NULL,
    org_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);