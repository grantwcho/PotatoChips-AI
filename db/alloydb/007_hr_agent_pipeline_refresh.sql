alter table if exists hr_agent_applications
  drop constraint if exists hr_agent_applications_status_check;

alter table if exists hr_agent_applications
  add constraint hr_agent_applications_status_check check (
    status in (
      'Quarantine',
      'Security scan',
      'Conformance',
      'Paper sim',
      'Shadow',
      'Intake',
      'Sandbox',
      'Adversarial',
      'Portfolio fit',
      'Probation',
      'Historical Backtest',
      'Live Simulation',
      'Onboarding',
      'Backburner',
      'Hired',
      'Rejected'
    )
  );
