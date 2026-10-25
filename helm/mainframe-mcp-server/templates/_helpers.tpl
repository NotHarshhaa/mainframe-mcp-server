{{/*
Expand the name of the chart.
*/}}
{{- define "mainframe-mcp-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mainframe-mcp-server.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version as used by the helm.sh/chart label.
*/}}
{{- define "mainframe-mcp-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "mainframe-mcp-server.labels" -}}
helm.sh/chart: {{ include "mainframe-mcp-server.chart" . }}
{{ include "mainframe-mcp-server.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "mainframe-mcp-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mainframe-mcp-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "mainframe-mcp-server.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mainframe-mcp-server.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Main image with tag (defaults to chart appVersion).
*/}}
{{- define "mainframe-mcp-server.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion | toString }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
Name of the secret holding credentials.
*/}}
{{- define "mainframe-mcp-server.secretName" -}}
{{- if .Values.credentials.existingSecret }}
{{- .Values.credentials.existingSecret }}
{{- else if .Values.credentials.create }}
{{- include "mainframe-mcp-server.fullname" . }}-credentials
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
Name of the configmap holding the policy file (empty string when disabled).
*/}}
{{- define "mainframe-mcp-server.policyConfigMap" -}}
{{- if .Values.policy.existingConfigMap }}
{{- .Values.policy.existingConfigMap }}
{{- else if .Values.policy.inline }}
{{- include "mainframe-mcp-server.fullname" . }}-policy
{{- else }}
{{- "" }}
{{- end }}
{{- end }}
