import { createBrowserRouter } from 'react-router'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ImportPage } from '@/features/import/ImportPage'
import { QuestionBankPage } from '@/features/questions/QuestionBankPage'
import { RankingPage } from '@/features/ranking/RankingPage'
import { SimuladoResultPage } from '@/features/simulado/SimuladoResultPage'
import { SimuladoRunnerPage } from '@/features/simulado/SimuladoRunnerPage'
import { SimuladoSetupPage } from '@/features/simulado/SimuladoSetupPage'
import { AppLayout } from './AppLayout'
import { NotFound } from './NotFound'
import { RequireAuth } from './RequireAuth'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Modo foco: simulado em andamento sem sidebar
  {
    path: '/simulados/:id',
    element: (
      <RequireAuth>
        <SimuladoRunnerPage />
      </RequireAuth>
    ),
  },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'simulados', element: <SimuladoSetupPage /> },
      { path: 'simulados/:id/resultado', element: <SimuladoResultPage /> },
      { path: 'questoes', element: <QuestionBankPage /> },
      { path: 'importar', element: <ImportPage /> },
      { path: 'ranking', element: <RankingPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
