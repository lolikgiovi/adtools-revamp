/// Oracle database integration module
///
/// This module provides Oracle Instant Client integration for AD Tools,
/// including client detection, connection management, and data comparison.

pub mod client;
pub mod connection;
pub mod models;
pub mod commands;
pub mod comparison;

pub use client::{check_client_ready, prime_client, resolve_client_path};
pub use connection::DatabaseConnection;
pub use models::{ConnectionConfig, Credentials};
