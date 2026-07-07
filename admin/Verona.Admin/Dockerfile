FROM node:24-alpine AS ui-build
WORKDIR /ui
COPY admin/ui/package*.json ./
RUN npm ci
COPY admin/ui/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /src
COPY admin/Verona.Admin/Verona.Admin.csproj ./
RUN dotnet restore Verona.Admin.csproj
COPY admin/Verona.Admin/ ./
RUN dotnet publish Verona.Admin.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=api-build /out/ ./
COPY --from=ui-build /ui/dist/ ./wwwroot/
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Verona.Admin.dll"]
