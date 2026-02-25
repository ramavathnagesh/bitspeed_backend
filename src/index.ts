import express from 'express';
import routes from './routes';

const app = express();
app.use(express.json());

app.use('/', routes);

// Add health check
app.get('/', (req, res) => {
  res.send('Bitespeed Identity Reconciliation Service is running');
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
}

export default app;
