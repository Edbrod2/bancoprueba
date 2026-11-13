require ('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const{boddy, validationResult} = require('express-validator')

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

// Reglas de validación para la transferencia bancaria
const validacionesTransferencia = [
  body('cuentaOrigen')
    .notEmpty().withMessage('La cuenta de origen es obligatoria')
    .isString().withMessage('La cuenta de origen debe ser texto'),
  body('cuentaDestino')
    .notEmpty().withMessage('La cuenta de destino es obligatoria')
    .isString().withMessage('La cuenta de destino debe ser texto')
    .custom((value, { req }) => {
      if (value === req.body.cuentaOrigen) {
        throw new Error('No puedes realizar transferencias a la misma cuenta de origen');
      }
      return true;
    }),
  body('monto')
    .notEmpty().withMessage('El monto es obligatorio')
    .isFloat({ gt: 0 }).withMessage('El monto debe ser un número mayor a 0')
];


// ENDPOINT: Transferencia Bancaria Segura (Atomizada)
app.post('/api/transferir', validacionesTransferencia, async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()){
    return res.status(400).json({errores: errores.array()});
  }
  const { cuentaOrigen, cuentaDestino, monto } = req.body;
  const client = await pool.connect();
  
  try {
    // 1. Iniciar Transacción
    await client.query('BEGIN');

    // 2. Descontar saldo de origen
    const resOrigen = await client.query(
      'UPDATE cuentas SET saldo = saldo - $1 WHERE numero_cuenta = $2 AND saldo >= $1 RETURNING *',
      [monto, cuentaOrigen]
    )

    if (resOrigen.rowCount === 0) {
      throw new Error('Saldo insuficiente o cuenta de origen inválida');
    };

    // 3. Acreditar saldo a destino
    const resDestino = await client.query(
      'UPDATE cuentas SET saldo = saldo + $1 WHERE numero_cuenta = $2 RETURNING *',
      [monto, cuentaDestino]
    );

    if (resDestino.rowCount === 0) {
      throw new Error('Cuenta de destino no encontrada');
    }

    // 4. Registrar en la tabla de auditoría con tipo_operacion
const resAuditoria = await client.query(
  'INSERT INTO rtransacciones (cuenta_origen, cuenta_destino, monto, tipo_operacion) VALUES ($1, $2, $3, $4) RETURNING *',
  [cuentaOrigen, cuentaDestino, monto, 'TRANSFERENCIA']
);
    // 5. Confirmar la transacción
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