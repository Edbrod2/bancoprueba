require ('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Conexión a PostgreSQL en Linux Mint
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD, // ✅ Lee la clave desde .env (ignorado por Git)
  port: process.env.DB_PORT,
});

// ENDPOINT: Transferencia Bancaria Segura (Atomizada)
app.post('/api/transferir', async (req, res) => {
  const { cuentaOrigen, cuentaDestino, monto } = req.body;
  const client = await pool.connect();

  try {
    // 1. Iniciar Transacción (Todo o Nada)
    await client.query('BEGIN');

    // 2. Descontar saldo de origen
    const resOrigen = await client.query(
      'UPDATE cuentas SET saldo = saldo - $1 WHERE numero_cuenta = $2 AND saldo >= $1 RETURNING *',
      [monto, cuentaOrigen]
    );

    if (resOrigen.rowCount === 0) {
      throw new Error('Saldo insuficiente o cuenta de origen inválida');
    }

    // 3. Acreditar saldo a destino
    const resDestino = await client.query(
      'UPDATE cuentas SET saldo = saldo + $1 WHERE numero_cuenta = $2 RETURNING *',
      [monto, cuentaDestino]
    );

    if (resDestino.rowCount === 0) {
      throw new Error('Cuenta de destino no encontrada');
    }

    // 4. Confirmar la transacción
    await client.query('COMMIT');

    res.status(200).json({
      mensaje: 'Transferencia realizada con éxito',
      origen: resOrigen.rows[0],
      destino: resDestino.rows[0]
    });

  } catch (error) {
    // Si algo falla, se revierte todo a su estado original
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor bancario escuchando en puerto ${PORT}`));