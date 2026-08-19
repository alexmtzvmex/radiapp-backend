CREATE TABLE IF NOT EXISTS mensajes_voz (
    id INT AUTO_INCREMENT PRIMARY KEY,
    canal_id INT NOT NULL,
    usuario VARCHAR(255) NOT NULL,
    usuario_id INT NULL,
    audio_base64 LONGTEXT NOT NULL,
    duracion_seg INT NULL,
    creado_en DATETIME NOT NULL,
    INDEX idx_canal_fecha (canal_id, creado_en)
);
