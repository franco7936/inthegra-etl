# Usuarios y permisos

Ruta web:

```text
/usuarios
```

Login:

```text
/login
```

APIs:

```text
/api/auth/login
/api/auth/logout
/api/auth/me
/api/usuarios
```

## Usuario inicial

El modelo crea un usuario inicial cuando se ejecuta el ETL o cuando se usa el login por primera vez:

```text
usuario: admin
contrasena temporal: admin123
```

Esta contrasena es temporal y debe cambiarse desde el modulo de usuarios cuando el portal quede operativo.

## Tablas

```text
app_users
app_report_permissions
```

`app_users` guarda:

- `username`
- `password_hash`
- `role`: `admin` o `viewer`
- `enabled`
- `fecha_carga`

`app_report_permissions` guarda:

- `username`
- `report_key`
- `can_view`
- `fecha_carga`

## Roles

- `admin`: puede administrar usuarios y permisos. Tiene todos los reportes habilitados.
- `viewer`: puede tener permisos puntuales por reporte.

## Estado actual

El modulo ya permite iniciar sesion y administrar usuarios/permisos.

La siguiente mejora recomendada es activar enforcement estricto por reporte, para que cada API/pagina valide `app_report_permissions` antes de mostrar datos.
