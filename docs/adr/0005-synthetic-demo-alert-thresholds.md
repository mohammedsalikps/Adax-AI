# ADR 0005: Alert thresholds are synthetic demo values until a clinical owner approves real ones

- **Status:** accepted (applies to the planned alerts slice)
- **Date:** 2 Oct 2026

## Context

Threshold alerts need numbers, for example "SpO₂ below X for N minutes". Choosing clinical thresholds is a clinical-governance decision. The directive forbids inventing them or presenting demonstration rules as medical guidance.

## Decision

- **Where rules live:** versioned configuration.
- **What each rule defines:** measurement, unit, condition, persistence, severity, recipient role, escalation, suppression window, active flag and rule-set version.
- **Shipped values:** only rules with `synthetic_demo: true`, whose names and every UI surface say *"Synthetic demo threshold, not clinical guidance"*.
- **Real installations:** the API refuses to evaluate synthetic demo rules when `DATA_ORIGIN=clinical`. Approved rules must name a clinical owner and an approval reference.
- **Simulated readings:** they are stored with a simulated origin and labelled everywhere. They are never seeded as real device data.

## Consequences

- The demo can show the full alert lifecycle without implying clinical validity.
- Real use stays blocked until a qualified owner supplies values. This is listed in STATUS.md as an external need.
