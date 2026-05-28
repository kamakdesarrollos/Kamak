import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Stat, Label, Note } from '../components/ui';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';

export default function Conciliacion() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin (conciliacion bancaria es operacion financiera).
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const banco = [
    ['02/05', 'TRF · Don Luis SRL', '-245.000', 'match', T.ok],
    ['04/05', 'TRF · Easy Construccion', '-380.000', 'match', T.ok],
    ['05/05', 'COMISION MANTEN.', '-12.500', 'sin match', T.accent],
    ['07/05', 'DEB SERVICIO LUZ EDENOR', '-45.800', 'sin match', T.accent],
    ['08/05', 'TRF DESDE · Familia Pérez', '+1.200.000', 'match', T.ok],
    ['10/05', 'TRF · Leandro V.', '-500.000', 'match', T.ok],
    ['12/05', 'IMPUESTO IIBB', '-18.700', 'sin match', T.accent],
    ['14/05', 'ECHEQ # 4421', '-350.000', 'match', T.ok],
  ];

  const sistema = [
    ['02/05', 'Pago Don Luis · Mat eléctrica · Bara', '-245.000', 'match', T.ok],
    ['04/05', 'Pago Easy · Mat albañilería · Pilar', '-380.000', 'match', T.ok],
    ['08/05', 'Cobro cliente · Familia Pérez · cuota 4', '+1.200.000', 'match', T.ok],
    ['10/05', 'Pago Leandro · Const seco · Bara', '-500.000', 'match', T.ok],
    ['11/05', 'Pago Ariel · Pintura · Tigre', '-180.000', 'huérfano', T.warn],
    ['14/05', 'ECHEQ #4421 · Leandro · Tigre', '-350.000', 'match', T.ok],
    ['15/05', 'Sueldo Juan · compras', '-200.000', 'huérfano', T.warn],
  ];

  return (
    <PageLayout breadcrumb={[{ label: 'Cajas', to: '/cajas' }, 'Banco Galicia ARS', 'Conciliación']} active="Cajas">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div>
          <div className="k-h" style={{ fontSize: 28 }}>Conciliación bancaria</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>Banco Galicia ARS · período 01–15 mayo 2026 · 48 movimientos del extracto</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm>↗ Importar extracto (.xlsx / .csv)</Btn>
          <Btn sm fill>Confirmar conciliación</Btn>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, padding: '10px 12px', background: '#f6efd9', borderRadius: 4, marginBottom: 10 }}>
        <Stat label="Saldo banco (extracto)" value="$ 2.290.000" />
        <Stat label="Saldo sistema" value="$ 2.300.000" />
        <Stat label="Diferencia" value="$ 10.000" accent />
        <Stat label="Conciliados auto" value="42 / 48" />
        <Stat label="Pendientes" value="6" />
      </div>

      <div style={{ display: 'flex', gap: 10, overflow: 'hidden', height: 'calc(100vh - 280px)' }}>
        {/* Extracto banco */}
        <Box style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '7px 10px', background: T.faint, borderBottom: `1.5px solid ${T.rule}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="k-h" style={{ fontSize: 16 }}>Extracto del banco</div>
            <Chip style={{ fontSize: 10 }}>48 movs</Chip>
          </div>
          <div style={{ flex: 1, overflow: 'auto', fontSize: 12 }}>
            {banco.map(([d, c, m, st, color], i) => (
              <div key={i} className="k-tr" style={{ alignItems: 'center', borderLeft: `3px solid ${color}` }}>
                <div className="k-cell" style={{ flex: 0.6, fontFamily: `'JetBrains Mono', monospace` }}>{d}</div>
                <div className="k-cell" style={{ flex: 2.5 }}>{c}</div>
                <div className="k-cell" style={{ flex: 1.2, textAlign: 'right', fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700, color: m.startsWith('-') ? T.accent : T.ok }}>{m}</div>
                <div className="k-cell" style={{ flex: 1.2, fontSize: 10 }}>
                  {st === 'match' ? <Chip ok style={{ fontSize: 10 }}>✓ {st}</Chip> : <Chip accent style={{ fontSize: 10 }}>! {st}</Chip>}
                </div>
                <div className="k-cell" style={{ flex: 0.8 }}>
                  {st === 'sin match' && <Btn sm>+ Crear gasto</Btn>}
                </div>
              </div>
            ))}
          </div>
        </Box>

        {/* Sistema */}
        <Box style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '7px 10px', background: T.faint, borderBottom: `1.5px solid ${T.rule}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="k-h" style={{ fontSize: 16 }}>Movimientos del sistema</div>
            <Chip style={{ fontSize: 10 }}>50 movs</Chip>
          </div>
          <div style={{ flex: 1, overflow: 'auto', fontSize: 12 }}>
            {sistema.map(([d, c, m, st, color], i) => (
              <div key={i} className="k-tr" style={{ alignItems: 'center', borderLeft: `3px solid ${color}` }}>
                <div className="k-cell" style={{ flex: 0.6, fontFamily: `'JetBrains Mono', monospace` }}>{d}</div>
                <div className="k-cell" style={{ flex: 2.5 }}>{c}</div>
                <div className="k-cell" style={{ flex: 1.2, textAlign: 'right', fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700, color: m.startsWith('-') ? T.accent : T.ok }}>{m}</div>
                <div className="k-cell" style={{ flex: 1.4, fontSize: 10 }}>
                  {st === 'match' ? <Chip ok style={{ fontSize: 10 }}>✓ conciliado</Chip> : <Chip warn style={{ fontSize: 10 }}>? sin extracto</Chip>}
                </div>
              </div>
            ))}
          </div>
        </Box>
      </div>

      <Note style={{ position: 'fixed', bottom: 18, right: 24, maxWidth: 230, zIndex: 10 }}>
        Match auto por monto + fecha (±2d) + nombre. Discrepancias: crear gasto desde el extracto o marcar como ignorado.
      </Note>
    </PageLayout>
  );
}
